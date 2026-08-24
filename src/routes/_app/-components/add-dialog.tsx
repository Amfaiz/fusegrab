import type { YoutubeVideoInfo } from '#/lib/services/youtube/types'

import { useEffect, useRef, useState } from 'react'

import { Loader2, Scissors, Video, X, Youtube } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
    Dialog,
    DialogBody,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogIconButton,
    DialogTitle,
} from '#/components/ui/dialog'
import { InputField, InputRoot, Textarea } from '#/components/ui/input'
import { Tab, TabList, TabPanel, Tabs } from '#/components/ui/tabs'
import {
    areAllValidYoutubeUrls,
    getInvalidYoutubeUrls,
    parseYoutubeUrls,
} from '#/lib/services/youtube/url'

import { isBotCheckError } from './retry'
import { VideoTrimmer } from './video-trimmer'

interface AddUrlModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    inputUrl: string
    setInputUrl: (val: string) => void
    loadingInfo: boolean
    error: string | null
    onSubmitBulk: (urls: string[]) => void
    onSubmitSingle: (options: {
        url: string
        info: YoutubeVideoInfo
        quality: string
        section?: { startSeconds: number; endSeconds: number }
    }) => void
    defaultQuality?: string
    signInStatus?: 'idle' | 'opened' | 'signed-in' | 'closed' | 'signed-out'
    onSignIn?: () => void
    initialClipUrl?: string | null
    initialClipSection?: { startSeconds: number; endSeconds: number } | null
    onClearInitialClipUrl?: () => void
}

export function AddUrlModal({
    open,
    onOpenChange,
    inputUrl,
    setInputUrl,
    loadingInfo,
    error,
    onSubmitBulk,
    onSubmitSingle,
    defaultQuality = 'Best',
    signInStatus = 'idle',
    onSignIn,
    initialClipUrl,
    initialClipSection,
    onClearInitialClipUrl,
}: AddUrlModalProps) {
    const [activeTab, setActiveTab] = useState<'url' | 'clip'>('url')
    const [videoInfo, setVideoInfo] = useState<YoutubeVideoInfo | null>(null)
    const [clipSection, setClipSection] = useState<{
        startSeconds: number
        endSeconds: number
    } | null>(null)
    const [loadingPreview, setLoadingPreview] = useState(false)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const lastFetchedUrlRef = useRef<string>('')

    const parsedUrls = parseYoutubeUrls(inputUrl)
    const isValid = areAllValidYoutubeUrls(inputUrl)
    const invalidUrls = getInvalidYoutubeUrls(inputUrl)

    // Handle initial clip URL passed from table row (opens Clip tab directly)
    useEffect(() => {
        if (open && initialClipUrl) {
            setInputUrl(initialClipUrl)
            setClipSection(initialClipSection || null)
            setActiveTab('clip')
            setLoadingPreview(true)
            setPreviewError(null)
            lastFetchedUrlRef.current = initialClipUrl
            window.api.youtube
                .getInfo(initialClipUrl)
                .then((info) => {
                    setVideoInfo(info)
                })
                .catch((err) => {
                    setPreviewError(
                        err?.message || 'Failed to load video preview',
                    )
                })
                .finally(() => {
                    setLoadingPreview(false)
                    if (onClearInitialClipUrl) onClearInitialClipUrl()
                })
        }
    }, [
        open,
        initialClipUrl,
        initialClipSection,
        onClearInitialClipUrl,
        setInputUrl,
    ])

    // Auto-fetch preview when on Clip tab and a valid single video URL is present
    useEffect(() => {
        if (!open) return
        if (activeTab !== 'clip') return

        const singleUrl =
            parsedUrls.length === 1 && isValid ? parsedUrls[0] : null
        if (!singleUrl) {
            setVideoInfo(null)
            return
        }

        if (singleUrl === lastFetchedUrlRef.current && videoInfo) {
            return
        }

        let cancelled = false
        const timer = setTimeout(async () => {
            setLoadingPreview(true)
            setPreviewError(null)
            lastFetchedUrlRef.current = singleUrl

            try {
                const type = await window.api.youtube.getUrlType(singleUrl)
                if (cancelled) return

                if (type === 'video') {
                    const info = await window.api.youtube.getInfo(singleUrl)
                    if (cancelled) return
                    setVideoInfo(info)
                } else {
                    setPreviewError(
                        'This is a channel URL. Clipping is available for individual videos.',
                    )
                    setVideoInfo(null)
                }
            } catch (err: any) {
                if (cancelled) return
                setPreviewError(err?.message || 'Failed to load video info')
                setVideoInfo(null)
            } finally {
                if (!cancelled) {
                    setLoadingPreview(false)
                }
            }
        }, 300)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [activeTab, inputUrl, isValid, open, parsedUrls, videoInfo])

    // Reset when modal closes
    useEffect(() => {
        if (!open) {
            setActiveTab('url')
            setVideoInfo(null)
            setPreviewError(null)
            setLoadingPreview(false)
            lastFetchedUrlRef.current = ''
        }
    }, [open])

    const isBusy = loadingInfo || loadingPreview
    const displayError = error || previewError

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (isBusy) return
                onOpenChange(nextOpen)
            }}
        >
            <DialogContent
                maxWidth="max-w-lg"
                className="max-h-[92vh] overflow-y-auto"
            >
                <Tabs
                    value={activeTab}
                    onValueChange={(val) => {
                        if (val) setActiveTab(val as 'url' | 'clip')
                    }}
                    className="flex flex-col"
                >
                    {/* Header with Base UI TabList */}
                    <div className="relative">
                        <DialogTitle className="sr-only">
                            Add YouTube URL or Clip Video
                        </DialogTitle>
                        <TabList className="pr-12">
                            <Tab value="url">
                                <Youtube className="mr-1.5 size-3.5" />
                                URL
                            </Tab>
                            <Tab value="clip">
                                <Scissors className="mr-1.5 size-3.5" />
                                Clip
                            </Tab>
                        </TabList>

                        <DialogClose
                            disabled={isBusy}
                            render={
                                <DialogIconButton
                                    aria-label="Close"
                                    disabled={isBusy}
                                    className="absolute top-2 right-3 disabled:pointer-events-none disabled:opacity-40"
                                >
                                    <X className="size-3.5" />
                                </DialogIconButton>
                            }
                        />
                    </div>

                    {/* URL Tab Content */}
                    <TabPanel value="url" className="flex flex-col">
                        <form
                            onSubmit={(e) => {
                                e.preventDefault()
                                if (
                                    !isBusy &&
                                    isValid &&
                                    parsedUrls.length > 0
                                ) {
                                    onSubmitBulk(parsedUrls)
                                }
                            }}
                        >
                            <DialogBody className="gap-3 pt-3">
                                <div className="flex flex-col gap-1.5">
                                    <Textarea
                                        autoFocus
                                        rows={4}
                                        placeholder="Paste YouTube URL(s) here (one per line)..."
                                        value={inputUrl}
                                        onChange={(e) =>
                                            setInputUrl(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                            if (
                                                e.key === 'Enter' &&
                                                (e.metaKey ||
                                                    e.ctrlKey ||
                                                    (!e.shiftKey &&
                                                        !inputUrl.includes(
                                                            '\n',
                                                        )))
                                            ) {
                                                e.preventDefault()
                                                if (
                                                    !isBusy &&
                                                    isValid &&
                                                    parsedUrls.length > 0
                                                ) {
                                                    onSubmitBulk(parsedUrls)
                                                }
                                            }
                                        }}
                                        disabled={isBusy}
                                        className="h-28 text-[13px] leading-relaxed"
                                    />
                                    {parsedUrls.length > 1 && isValid && (
                                        <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                                            <span>
                                                {parsedUrls.length} URLs
                                                detected
                                            </span>
                                        </div>
                                    )}
                                    {invalidUrls.length > 0 &&
                                        inputUrl.trim() && (
                                            <p className="text-danger text-xs">
                                                {invalidUrls.length === 1
                                                    ? 'Invalid YouTube URL entered'
                                                    : `${invalidUrls.length} invalid YouTube URLs entered`}
                                            </p>
                                        )}
                                </div>

                                {displayError && (
                                    <div className="space-y-2">
                                        <p className="text-danger text-xs">
                                            {displayError}
                                        </p>
                                        {isBotCheckError(displayError) &&
                                            onSignIn && (
                                                <Button
                                                    type="button"
                                                    variant="default"
                                                    size="sm"
                                                    block
                                                    disabled={
                                                        signInStatus ===
                                                            'opened' ||
                                                        signInStatus ===
                                                            'signed-in'
                                                    }
                                                    onClick={onSignIn}
                                                >
                                                    <Youtube />
                                                    {signInStatus === 'opened'
                                                        ? 'Signing in… finish in your browser'
                                                        : signInStatus ===
                                                            'signed-in'
                                                          ? 'Signed in — press Continue to retry'
                                                          : 'Sign in to YouTube once (in your browser)'}
                                                </Button>
                                            )}
                                    </div>
                                )}
                            </DialogBody>

                            <DialogFooter>
                                <Button
                                    type="submit"
                                    variant="primary"
                                    block
                                    disabled={
                                        isBusy ||
                                        !isValid ||
                                        parsedUrls.length === 0
                                    }
                                >
                                    {isBusy && (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    )}
                                    {parsedUrls.length > 1
                                        ? `Continue (${parsedUrls.length})`
                                        : 'Continue'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </TabPanel>

                    {/* Clip Tab Content */}
                    <TabPanel value="clip" className="flex flex-col">
                        <DialogBody className="gap-3 pt-3 pb-4">
                            {/* URL Input Bar in Clip Tab */}
                            <div className="flex flex-col gap-1.5">
                                <InputRoot>
                                    <InputField
                                        autoFocus
                                        placeholder="https://www.youtube.com/watch?v=..."
                                        value={inputUrl}
                                        onChange={(e) =>
                                            setInputUrl(e.target.value)
                                        }
                                        disabled={isBusy}
                                        className="text-xs"
                                    />
                                    {inputUrl && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setInputUrl('')
                                                setVideoInfo(null)
                                                lastFetchedUrlRef.current = ''
                                            }}
                                            className="text-muted-foreground hover:text-foreground p-1"
                                            title="Clear"
                                        >
                                            <X className="size-3.5" />
                                        </button>
                                    )}
                                </InputRoot>

                                {invalidUrls.length > 0 && inputUrl.trim() && (
                                    <p className="text-danger text-xs">
                                        Please enter a valid YouTube video URL.
                                    </p>
                                )}
                            </div>

                            {/* Loading State */}
                            {loadingPreview && (
                                <div className="bg-muted/30 border-border/60 flex flex-col items-center justify-center gap-2 rounded-lg border py-8">
                                    <Loader2 className="text-primary size-6 animate-spin" />
                                    <span className="text-muted-foreground text-xs font-medium">
                                        Loading video preview and timeline...
                                    </span>
                                </div>
                            )}

                            {/* Error Alert */}
                            {displayError && !loadingPreview && (
                                <div className="border-danger/30 bg-danger/5 space-y-2 rounded-lg border p-3">
                                    <p className="text-danger text-xs">
                                        {displayError}
                                    </p>
                                    {isBotCheckError(displayError) &&
                                        onSignIn && (
                                            <Button
                                                type="button"
                                                variant="default"
                                                size="sm"
                                                block
                                                disabled={
                                                    signInStatus === 'opened' ||
                                                    signInStatus === 'signed-in'
                                                }
                                                onClick={onSignIn}
                                            >
                                                <Youtube className="size-3.5" />
                                                {signInStatus === 'opened'
                                                    ? 'Signing in… finish in your browser'
                                                    : signInStatus ===
                                                        'signed-in'
                                                      ? 'Signed in — retry now'
                                                      : 'Sign in to YouTube once (in your browser)'}
                                            </Button>
                                        )}
                                </div>
                            )}

                            {/* Video Trimmer View */}
                            {videoInfo && !loadingPreview && (
                                <VideoTrimmer
                                    url={
                                        parsedUrls[0] ||
                                        lastFetchedUrlRef.current
                                    }
                                    info={videoInfo}
                                    initialSection={clipSection || undefined}
                                    defaultQuality={defaultQuality}
                                    loading={isBusy}
                                    onDownload={(opts) => {
                                        onSubmitSingle({
                                            url:
                                                parsedUrls[0] ||
                                                lastFetchedUrlRef.current,
                                            info: videoInfo,
                                            quality: opts.quality,
                                            section: opts.section,
                                        })
                                    }}
                                />
                            )}

                            {/* Empty state hint */}
                            {!inputUrl.trim() && !loadingPreview && (
                                <div className="text-muted-foreground border-border/80 bg-surface/50 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-center">
                                    <Video className="size-8 opacity-40" />
                                    <p className="px-4 text-xs">
                                        Paste a YouTube video link above to
                                        preview and select a custom section to
                                        download.
                                    </p>
                                </div>
                            )}
                        </DialogBody>
                    </TabPanel>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}
