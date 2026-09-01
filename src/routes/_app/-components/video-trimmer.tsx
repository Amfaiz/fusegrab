import type { YoutubeVideoInfo } from '#/lib/services/youtube/types'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
    ArrowLeft,
    ChevronDownIcon,
    Pause,
    Play,
    RefreshCw,
    Scissors,
} from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
    Select,
    SelectContent,
    SelectIcon,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'

import { extractYoutubeVideoId } from '#/lib/services/youtube/url'

import { formatTimeCode, parseTimeCode } from './types'

interface VideoTrimmerProps {
    url: string
    info: YoutubeVideoInfo
    initialSection?: { startSeconds: number; endSeconds: number }
    defaultQuality?: string
    onDownload: (options: {
        quality: string
        section?: { startSeconds: number; endSeconds: number }
    }) => void
    onBack?: () => void
    loading?: boolean
}

export function VideoTrimmer({
    url,
    info,
    initialSection,
    defaultQuality = 'Best',
    onDownload,
    onBack,
    loading = false,
}: VideoTrimmerProps) {
    const videoId = extractYoutubeVideoId(url)
    const initialDuration = Math.max(
        1,
        Math.round(
            info.durationSeconds || initialSection?.endSeconds || 60,
        ),
    )
    const [totalDuration, setTotalDuration] = useState(initialDuration)

    useEffect(() => {
        if (info.durationSeconds && info.durationSeconds > 0) {
            const dur = Math.max(1, Math.round(info.durationSeconds))
            setTotalDuration(dur)
            setEndSeconds((prevEnd) => {
                if (!initialSection && (prevEnd === 60 || prevEnd > dur)) {
                    return dur
                }
                return Math.min(dur, prevEnd)
            })
        }
    }, [info.durationSeconds, initialSection])

    const initStart =
        initialSection?.startSeconds !== undefined
            ? Math.max(0, Math.min(totalDuration, initialSection.startSeconds))
            : 0
    const initEnd =
        initialSection?.endSeconds !== undefined
            ? Math.max(
                  initStart + 0.1,
                  Math.min(totalDuration, initialSection.endSeconds),
              )
            : totalDuration

    const [startSeconds, setStartSeconds] = useState(initStart)
    const [endSeconds, setEndSeconds] = useState(initEnd)
    const [currentTime, setCurrentTime] = useState(initStart)
    const [isPlaying, setIsPlaying] = useState(false)
    const [quality, setQuality] = useState(defaultQuality || 'Best')

    const [startInput, setStartInput] = useState(formatTimeCode(initStart))
    const [endInput, setEndInput] = useState(formatTimeCode(initEnd))

    const iframeRef = useRef<HTMLIFrameElement>(null)
    const timelineRef = useRef<HTMLDivElement>(null)
    const activeDragRef = useRef<{
        type: 'start' | 'end' | 'middle'
        startX: number
        initialStart: number
        initialEnd: number
    } | null>(null)

    const [isDragging, setIsDragging] = useState<
        'start' | 'end' | 'middle' | null
    >(null)

    const startSecondsRef = useRef(startSeconds)
    const endSecondsRef = useRef(endSeconds)

    useEffect(() => {
        startSecondsRef.current = startSeconds
        setStartInput(formatTimeCode(startSeconds))
    }, [startSeconds])

    useEffect(() => {
        endSecondsRef.current = endSeconds
        setEndInput(formatTimeCode(endSeconds))
    }, [endSeconds])

    // Post command to YouTube embedded iframe
    const postPlayerCommand = useCallback(
        (func: string, args: unknown[] = []) => {
            if (!iframeRef.current?.contentWindow) return
            iframeRef.current.contentWindow.postMessage(
                JSON.stringify({
                    event: 'command',
                    func,
                    args,
                }),
                '*',
            )
        },
        [],
    )

    const seekTo = useCallback(
        (sec: number) => {
            const clamped = Math.max(0, Math.min(totalDuration, sec))
            setCurrentTime(clamped)
            postPlayerCommand('seekTo', [clamped, true])
        },
        [postPlayerCommand, totalDuration],
    )

    useEffect(() => {
        if (initialSection) {
            const s = Math.max(
                0,
                Math.min(totalDuration, initialSection.startSeconds),
            )
            const e = Math.max(
                s + 0.1,
                Math.min(totalDuration, initialSection.endSeconds),
            )
            setStartSeconds(s)
            setEndSeconds(e)
            setCurrentTime(s)
            seekTo(s)
        }
    }, [initialSection, totalDuration, seekTo])

    const playVideo = useCallback(() => {
        postPlayerCommand('playVideo')
        setIsPlaying(true)
    }, [postPlayerCommand])

    const pauseVideo = useCallback(() => {
        postPlayerCommand('pauseVideo')
        setIsPlaying(false)
    }, [postPlayerCommand])

    // Listen to messages from YouTube Player API
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            try {
                const data =
                    typeof event.data === 'string'
                        ? JSON.parse(event.data)
                        : event.data

                if (!data || typeof data !== 'object') return

                if (data.event === 'infoDelivery' && data.info) {
                    const reportedDuration =
                        typeof data.info.duration === 'number'
                            ? data.info.duration
                            : typeof data.info.progressState?.duration ===
                                'number'
                              ? data.info.progressState.duration
                              : null

                    if (reportedDuration && reportedDuration > 0) {
                        const dur = Math.max(1, Math.round(reportedDuration))
                        setTotalDuration((prevDur) => {
                            if (prevDur !== dur) {
                                setEndSeconds((prevEnd) => {
                                    if (
                                        !initialSection &&
                                        (prevEnd === prevDur ||
                                            prevEnd === 60 ||
                                            prevEnd > dur)
                                    ) {
                                        return dur
                                    }
                                    return Math.min(dur, prevEnd)
                                })
                                return dur
                            }
                            return prevDur
                        })
                    }

                    if (typeof data.info.currentTime === 'number') {
                        const time = data.info.currentTime
                        setCurrentTime(time)

                        // If playback reached end of range, stop and reset to start
                        if (time >= endSecondsRef.current) {
                            pauseVideo()
                            seekTo(startSecondsRef.current)
                        }
                    }
                }

                if (
                    data.event === 'onStateChange' ||
                    (data.event === 'infoDelivery' &&
                        data.info?.playerState !== undefined)
                ) {
                    const state =
                        data.data !== undefined
                            ? data.data
                            : data.info?.playerState
                    // 1 = playing, 2 = paused, 0 = ended
                    if (state === 1) {
                        setIsPlaying(true)
                    } else if (state === 2 || state === 0) {
                        setIsPlaying(false)
                    }
                }
            } catch {}
        }

        window.addEventListener('message', handleMessage)

        return () => {
            window.removeEventListener('message', handleMessage)
        }
    }, [pauseVideo, seekTo])

    // Poll for current time when playing for high-precision time tracking
    useEffect(() => {
        const intervalTime = isPlaying ? 100 : 500
        const interval = setInterval(() => {
            if (iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.postMessage(
                    JSON.stringify({ event: 'listening' }),
                    '*',
                )
            }
        }, intervalTime)

        return () => clearInterval(interval)
    }, [isPlaying])

    const handlePreviewClip = () => {
        seekTo(startSeconds)
        playVideo()
    }

    const handleResetFull = () => {
        setStartSeconds(0)
        setEndSeconds(totalDuration)
        seekTo(0)
    }

    const handleStartInputBlur = () => {
        const parsed = parseTimeCode(startInput)
        if (parsed !== null && parsed >= 0 && parsed < endSeconds) {
            setStartSeconds(parsed)
            seekTo(parsed)
        } else {
            setStartInput(formatTimeCode(startSeconds))
        }
    }

    const handleEndInputBlur = () => {
        const parsed = parseTimeCode(endInput)
        if (
            parsed !== null &&
            parsed > startSeconds &&
            parsed <= totalDuration
        ) {
            setEndSeconds(parsed)
            seekTo(parsed)
        } else {
            setEndInput(formatTimeCode(endSeconds))
        }
    }

    const stepStart = (delta: number) => {
        const next = Math.max(0, Math.min(endSeconds - 1, startSeconds + delta))
        setStartSeconds(next)
        seekTo(next)
    }

    const stepEnd = (delta: number) => {
        const next = Math.max(
            startSeconds + 1,
            Math.min(totalDuration, endSeconds + delta),
        )
        setEndSeconds(next)
        seekTo(next)
    }

    // Timeline Drag Handlers
    const handleTimelinePointerDown = (
        e: React.PointerEvent<HTMLDivElement>,
        type: 'start' | 'end' | 'middle' | 'track',
    ) => {
        e.preventDefault()
        e.stopPropagation()

        if (!timelineRef.current) return
        const rect = timelineRef.current.getBoundingClientRect()
        const clientX = e.clientX

        if (type === 'track') {
            const ratio = Math.max(
                0,
                Math.min(1, (clientX - rect.left) / rect.width),
            )
            const clickedSeconds = ratio * totalDuration
            seekTo(clickedSeconds)
            return
        }

        activeDragRef.current = {
            type,
            startX: clientX,
            initialStart: startSeconds,
            initialEnd: endSeconds,
        }
        setIsDragging(type)

        const onPointerMove = (moveEvent: PointerEvent) => {
            if (!activeDragRef.current || !timelineRef.current) return
            const currentRect = timelineRef.current.getBoundingClientRect()
            const deltaX = moveEvent.clientX - activeDragRef.current.startX
            const deltaSeconds = (deltaX / currentRect.width) * totalDuration

            if (activeDragRef.current.type === 'start') {
                const newStart = Math.max(
                    0,
                    Math.min(
                        activeDragRef.current.initialEnd - 1,
                        Math.round(
                            activeDragRef.current.initialStart + deltaSeconds,
                        ),
                    ),
                )
                setStartSeconds(newStart)
                seekTo(newStart)
            } else if (activeDragRef.current.type === 'end') {
                const newEnd = Math.max(
                    activeDragRef.current.initialStart + 1,
                    Math.min(
                        totalDuration,
                        Math.round(
                            activeDragRef.current.initialEnd + deltaSeconds,
                        ),
                    ),
                )
                setEndSeconds(newEnd)
                seekTo(newEnd)
            } else if (activeDragRef.current.type === 'middle') {
                const clipLength =
                    activeDragRef.current.initialEnd -
                    activeDragRef.current.initialStart
                let newStart = Math.round(
                    activeDragRef.current.initialStart + deltaSeconds,
                )
                let newEnd = newStart + clipLength

                if (newStart < 0) {
                    newStart = 0
                    newEnd = clipLength
                }
                if (newEnd > totalDuration) {
                    newEnd = totalDuration
                    newStart = totalDuration - clipLength
                }

                setStartSeconds(newStart)
                setEndSeconds(newEnd)
            }
        }

        const onPointerUp = () => {
            activeDragRef.current = null
            setIsDragging(null)
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
        }

        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
    }

    const isFullVideo = startSeconds === 0 && endSeconds === totalDuration
    const selectedDuration = Math.max(0, endSeconds - startSeconds)

    const startPercent = Math.max(
        0,
        Math.min(100, (startSeconds / totalDuration) * 100),
    )
    const endPercent = Math.max(
        0,
        Math.min(100, (endSeconds / totalDuration) * 100),
    )
    const currentPercent = Math.max(
        0,
        Math.min(100, (currentTime / totalDuration) * 100),
    )

    const handleSubmit = () => {
        onDownload({
            quality,
            section: isFullVideo
                ? undefined
                : {
                      startSeconds,
                      endSeconds,
                  },
        })
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Header info: Title & Total Length */}
            <div className="flex items-center justify-between gap-3 px-0.5">
                {onBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors"
                    >
                        <ArrowLeft className="size-3.5" />
                        Back
                    </button>
                )}
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span
                        className="text-foreground truncate text-xs font-semibold"
                        title={info.title}
                    >
                        {info.title}
                    </span>
                    <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                        {formatTimeCode(totalDuration)}
                    </span>
                </div>
            </div>

            {/* Video Player Preview */}
            <div className="border-border relative aspect-video w-full overflow-hidden rounded-lg border bg-black shadow-inner">
                {videoId ? (
                    <iframe
                        ref={iframeRef}
                        title={info.title}
                        src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&controls=1&rel=0&modestbranding=1`}
                        className="h-full w-full border-0"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    />
                ) : (
                    <div className="relative flex h-full w-full items-center justify-center">
                        <img
                            src={info.thumbnail}
                            alt={info.title}
                            className="h-full w-full object-cover opacity-70"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <Scissors className="size-8 text-white/80" />
                        </div>
                    </div>
                )}
            </div>

            {/* Trimmer Controls Box */}
            <div className="bg-muted/30 border-border/80 flex flex-col gap-2.5 rounded-lg border p-3">
                {/* Time Range Bar: [Start] - [End] on left, Duration + Play icon on right */}
                <div className="flex items-center justify-between gap-2 text-xs">
                    {/* Left: Start and End inputs */}
                    <div className="flex items-center gap-1.5">
                        <input
                            type="text"
                            value={startInput}
                            onChange={(e) => setStartInput(e.target.value)}
                            onBlur={handleStartInputBlur}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleStartInputBlur()
                            }}
                            className="border-border bg-surface text-foreground focus:border-border-strong focus:ring-ring/40 h-7 w-16 rounded border text-center font-mono text-xs shadow-2xs outline-none focus:ring-1"
                            placeholder="00:00"
                        />
                        <span className="text-muted-foreground font-mono text-xs">
                            –
                        </span>
                        <input
                            type="text"
                            value={endInput}
                            onChange={(e) => setEndInput(e.target.value)}
                            onBlur={handleEndInputBlur}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleEndInputBlur()
                            }}
                            className="border-border bg-surface text-foreground focus:border-border-strong focus:ring-ring/40 h-7 w-16 rounded border text-center font-mono text-xs shadow-2xs outline-none focus:ring-1"
                            placeholder="00:00"
                        />
                    </div>

                    {/* Right: Total clip duration and Preview play icon */}
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground font-mono text-xs font-medium">
                            {formatTimeCode(selectedDuration)}
                        </span>
                        <button
                            type="button"
                            onClick={isPlaying ? pauseVideo : handlePreviewClip}
                            className="border-border bg-surface text-foreground hover:bg-accent inline-flex size-7 items-center justify-center rounded-md border shadow-2xs transition-colors"
                            title={isPlaying ? 'Pause Preview' : 'Preview Clip'}
                            aria-label={
                                isPlaying ? 'Pause Preview' : 'Preview Clip'
                            }
                        >
                            {isPlaying ? (
                                <Pause className="size-3 fill-amber-500 text-amber-500" />
                            ) : (
                                <Play className="text-foreground fill-foreground ml-0.5 size-3" />
                            )}
                        </button>
                    </div>
                </div>

                {/* Dual-Range Timeline Bar */}
                <div className="relative py-2.5 select-none">
                    <div
                        ref={timelineRef}
                        onPointerDown={(e) =>
                            handleTimelinePointerDown(e, 'track')
                        }
                        className="relative flex h-5 w-full cursor-pointer items-center"
                    >
                        {/* Full Track Rail (Light Grey Background) */}
                        <div className="h-[3px] w-full rounded-full bg-neutral-200 dark:bg-neutral-700" />

                        {/* Selected Active Range Rail (Dark Charcoal / Black) */}
                        <div
                            onPointerDown={(e) =>
                                handleTimelinePointerDown(e, 'middle')
                            }
                            className="absolute h-[3px] cursor-grab rounded-full bg-neutral-800 active:cursor-grabbing dark:bg-neutral-100"
                            style={{
                                left: `${startPercent}%`,
                                width: `${Math.max(0, endPercent - startPercent)}%`,
                            }}
                            title="Drag to shift clip position"
                        />

                        {/* Current Playhead indicator */}
                        <div
                            className="pointer-events-none absolute top-1/2 z-10 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-xs"
                            style={{ left: `${currentPercent}%` }}
                        />
                    </div>

                    {/* Left Handle (Start) */}
                    <div
                        onPointerDown={(e) =>
                            handleTimelinePointerDown(e, 'start')
                        }
                        className="group absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none"
                        style={{ left: `${startPercent}%` }}
                    >
                        <div className="h-5 w-2.5 rounded-[3px] border border-neutral-400/90 bg-white shadow-xs transition-transform hover:scale-110 active:scale-115 dark:border-neutral-400" />
                        {/* Tooltip on drag/hover */}
                        <div
                            className="bg-popover text-foreground border-border pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap opacity-0 shadow-md transition-opacity group-hover:opacity-100 data-[active=true]:opacity-100"
                            data-active={isDragging === 'start'}
                        >
                            {formatTimeCode(startSeconds)}
                        </div>
                    </div>

                    {/* Right Handle (End) */}
                    <div
                        onPointerDown={(e) =>
                            handleTimelinePointerDown(e, 'end')
                        }
                        className="group absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none"
                        style={{ left: `${endPercent}%` }}
                    >
                        <div className="h-5 w-2.5 rounded-[3px] border border-neutral-400/90 bg-white shadow-xs transition-transform hover:scale-110 active:scale-115 dark:border-neutral-400" />
                        {/* Tooltip on drag/hover */}
                        <div
                            className="bg-popover text-foreground border-border pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap opacity-0 shadow-md transition-opacity group-hover:opacity-100 data-[active=true]:opacity-100"
                            data-active={isDragging === 'end'}
                        >
                            {formatTimeCode(endSeconds)}
                        </div>
                    </div>
                </div>

                {/* Sub-actions: Nudge Steppers & Full Video Reset */}
                <div className="flex items-center justify-between text-[11px]">
                    <div className="text-muted-foreground flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => stepStart(-1)}
                            className="hover:bg-accent hover:text-foreground rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors"
                            title="Start -1s"
                        >
                            -1s
                        </button>
                        <button
                            type="button"
                            onClick={() => stepStart(1)}
                            className="hover:bg-accent hover:text-foreground rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors"
                            title="Start +1s"
                        >
                            +1s
                        </button>
                    </div>

                    {!isFullVideo && (
                        <button
                            type="button"
                            onClick={handleResetFull}
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] font-medium transition-colors"
                        >
                            <RefreshCw className="size-2.5" />
                            Full Video
                        </button>
                    )}

                    <div className="text-muted-foreground flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => stepEnd(-1)}
                            className="hover:bg-accent hover:text-foreground rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors"
                            title="End -1s"
                        >
                            -1s
                        </button>
                        <button
                            type="button"
                            onClick={() => stepEnd(1)}
                            className="hover:bg-accent hover:text-foreground rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors"
                            title="End +1s"
                        >
                            +1s
                        </button>
                    </div>
                </div>
            </div>

            {/* Quality and Format Selector */}
            <div className="flex items-center justify-between gap-3 pt-0.5">
                <label className="text-foreground/90 text-xs font-medium">
                    Download Quality
                </label>
                <div className="w-44">
                    <Select
                        value={quality}
                        onValueChange={(val) => {
                            if (val) setQuality(val)
                        }}
                    >
                        <SelectTrigger className="border-border bg-surface hover:border-border-strong h-8 w-full justify-between px-2.5 text-xs font-medium">
                            <SelectValue placeholder="Best" />
                            <SelectIcon className="text-muted-foreground shrink-0">
                                <ChevronDownIcon className="size-3.5" />
                            </SelectIcon>
                        </SelectTrigger>
                        <SelectContent align="end">
                            <SelectItem value="Best">Best Quality</SelectItem>
                            <SelectItem value="1080p">1080p</SelectItem>
                            <SelectItem value="720p">720p</SelectItem>
                            <SelectItem value="480p">480p</SelectItem>
                            <SelectItem value="360p">360p</SelectItem>
                            <SelectItem value="Audio Only">
                                Audio Only (MP3)
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Bottom Action Footer */}
            <Button
                variant="primary"
                block
                disabled={loading || selectedDuration <= 0}
                onClick={handleSubmit}
                className="h-9 gap-2 text-xs font-semibold"
            >
                {isFullVideo ? (
                    <>Download Full Video ({formatTimeCode(totalDuration)})</>
                ) : (
                    <>
                        <Scissors className="size-3.5" />
                        Download Clip ({formatTimeCode(startSeconds)} -{' '}
                        {formatTimeCode(endSeconds)})
                    </>
                )}
            </Button>
        </div>
    )
}
