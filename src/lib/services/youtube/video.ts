import type { SessionLogger } from '../logger/service'
import type {
    ActiveDownloadState,
    DownloadOptions,
    YoutubeFormatInfo,
    YoutubeVideoInfo,
} from './types'
import type { BrowserWindow } from 'electron'

import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import path from 'node:path'

import { getSessionLogger } from '../logger/service'

import { ensureFfmpegBinary, ensureYtDlpBinary, spawnOptions } from './binary'
import { buildVideoFormatSelector } from './format'
import {
    buildStreamWeights,
    computeWeightedPercent,
    createStartPercentGuard,
    parseStreamCount,
    parseYtDlpPercent,
} from './progress'
import {
    buildFailureMessage,
    buildYtDlpAttempts,
    runJsonAttempts,
    shouldContinueToNextAttempt,
    shouldRetryWithAlternative,
} from './retry'

export async function getYoutubeVideoInfo(
    url: string,
    win?: BrowserWindow | null,
    logger?: SessionLogger,
): Promise<YoutubeVideoInfo> {
    const cleanUrl = url.trim()
    if (!cleanUrl) {
        throw new Error('Invalid YouTube video URL')
    }

    // yt-dlp and the strategy ladder (aria2, deno, cookie jar) are independent
    // — fetch them in parallel so the first run stalls on the slowest, not the
    // sum. The shared download promise in ensureYtDlpBinary dedupes against
    // the startup pre-warm.
    const [ytDlpPath, attempts] = await Promise.all([
        ensureYtDlpBinary(),
        buildYtDlpAttempts(win, logger),
    ])
    const stdout = await runJsonAttempts(
        ytDlpPath,
        attempts,
        ['--no-playlist', '--dump-single-json', cleanUrl],
        logger,
    )

    const data = JSON.parse(stdout)
    const seenHeights = new Set<number>()
    const formats: YoutubeFormatInfo[] = []

    if (Array.isArray(data.formats)) {
        const videoFormats = data.formats
            .filter((f: any) => f.vcodec !== 'none' && f.height)
            .sort((a: any, b: any) => (b.height || 0) - (a.height || 0))

        for (const f of videoFormats) {
            const h = f.height
            if (h && !seenHeights.has(h)) {
                seenHeights.add(h)
                const label = `${h}p${f.fps > 30 ? f.fps : ''}`
                formats.push({
                    qualityLabel: label,
                    container: 'mp4',
                    hasVideo: true,
                    hasAudio: f.acodec !== 'none',
                    itag: h,
                    height: h,
                })
            }
        }
    }

    formats.push({
        qualityLabel: 'Audio Only (MP3)',
        container: 'mp3',
        hasVideo: false,
        hasAudio: true,
        itag: -1,
        isAudioOnly: true,
    })

    return {
        title: data.title || 'YouTube Video',
        thumbnail:
            data.thumbnail ||
            `https://i.ytimg.com/vi/${data.id}/maxresdefault.jpg`,
        durationSeconds: Math.round(data.duration || 0),
        author: data.uploader || data.channel || 'YouTube',
        url: data.webpage_url || cleanUrl,
        formats:
            formats.length > 0
                ? formats
                : [
                      {
                          qualityLabel: '720p',
                          container: 'mp4',
                          hasVideo: true,
                          hasAudio: true,
                          itag: 720,
                          height: 720,
                      },
                  ],
    }
}

interface VideoAttemptDeps {
    ytDlpPath: string
    args: string[]
    win: BrowserWindow | null
    cleanUrl: string
    savePath: string
    isAudioOnly: boolean
    logger: SessionLogger
    onProcessStart: (proc: any) => void
    onProcessEnd: () => void
    updateState: (patch: Partial<ActiveDownloadState>) => void
    startPower: () => void
    stopPower: () => void
}

/**
 * One yt-dlp spawn for a single-video download. Progress events are streamed to
 * the renderer; the promise resolves with the verified output path or rejects
 * with a message derived from yt-dlp's stderr.
 */
async function runVideoDownloadAttempt(
    deps: VideoAttemptDeps,
): Promise<{ filePath: string }> {
    const {
        ytDlpPath,
        args,
        win,
        cleanUrl,
        savePath,
        isAudioOnly,
        logger,
        onProcessStart,
        onProcessEnd,
        updateState,
        startPower,
        stopPower,
    } = deps

    logger.info(`Spawning yt-dlp child process with: ${args.join(' ')}`)

    startPower()
    updateState({
        isDownloading: true,
        downloadType: 'video',
        url: cleanUrl,
        progress: { downloadedBytes: 0, totalBytes: 0, percent: 0 },
        channelProgress: null,
    })

    const proc = spawn(ytDlpPath, args, spawnOptions())
    onProcessStart(proc)
    logger.info(`yt-dlp child process spawned with PID ${proc.pid}`)

    const stderrLines: string[] = []
    const rawStderrLines: string[] = []

    // Weighted multi-stream progress tracking
    // Video+audio downloads report two separate 0-100% streams. We weight
    // them: stream 1 (video) = 0-80%, stream 2 (audio) = 80-95%,
    // merge/finalize = 95-100%. yt-dlp announces the format list
    // (`[info] ... Downloading N format(s): 395+251`) before downloading;
    // a `+` pair is two streams, a single combined format — which happens
    // with the tv-downgraded-player HLS streams — is one stream that gets
    // the whole 0-100% bar.
    let currentStream = 0
    let lastRawPercent = 0
    let maxEmittedPercent = 0
    let streamCountKnown = false
    let streamWeights = buildStreamWeights(isAudioOnly ? 1 : 2, isAudioOnly)
    const startPercentGuard = createStartPercentGuard()

    return new Promise((resolve, reject) => {
        proc.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n')
            for (const line of lines) {
                logger.logStdoutLine(line)

                const streamCount = parseStreamCount(line)
                if (streamCount !== null) {
                    streamWeights = buildStreamWeights(
                        streamCount,
                        isAudioOnly,
                    )
                    streamCountKnown = true
                }

                // HLS formats download as one combined stream, and the
                // format-count line is often missing for them. Without this,
                // the default two-stream weights would cap the bar at 80%.
                if (
                    !streamCountKnown &&
                    line.includes('[hlsnative] Total fragments:')
                ) {
                    streamWeights = buildStreamWeights(1, isAudioOnly)
                }

                // Detect stream switch via "Destination:" line
                if (line.includes('[download] Destination:')) {
                    if (currentStream > 0 || lastRawPercent > 50) {
                        currentStream++
                    }
                    lastRawPercent = 0
                    startPercentGuard.reset()
                    continue
                }

                // Detect merge phase
                if (
                    line.includes('[Merger]') ||
                    line.includes('Merging') ||
                    line.includes('[ffmpeg]') ||
                    line.includes('Deleting original file')
                ) {
                    maxEmittedPercent = Math.max(maxEmittedPercent, 99)
                    const p = {
                        downloadedBytes: 0,
                        totalBytes: 0,
                        percent: maxEmittedPercent,
                    }
                    updateState({ progress: p })
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('youtube:progress', p)
                    }
                    continue
                }

                const rawPercent = parseYtDlpPercent(line)
                if (rawPercent !== null) {
                    // Detect stream switch via large percent drop
                    if (
                        rawPercent < lastRawPercent - 20 &&
                        lastRawPercent > 50
                    ) {
                        currentStream++
                        startPercentGuard.reset()
                    }
                    lastRawPercent = rawPercent

                    // Ignore a near-100% value until real progress has been
                    // seen in this stream (hlsnative's pre-fetch placeholder).
                    if (!startPercentGuard.accept(rawPercent)) continue

                    const weightedPercent = computeWeightedPercent(
                        rawPercent,
                        currentStream,
                        streamWeights,
                        maxEmittedPercent,
                    )
                    maxEmittedPercent = weightedPercent

                    const p = {
                        downloadedBytes: 0,
                        totalBytes: 0,
                        percent: Math.round(weightedPercent * 10) / 10,
                    }
                    updateState({ progress: p })
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('youtube:progress', p)
                    }
                }
            }
        })

        proc.stderr.on('data', (data: Buffer) => {
            const str = data.toString()
            logger.logStderrLine(str)
            rawStderrLines.push(str.trim())
            if (!str.includes('WARNING:')) {
                stderrLines.push(str.trim())
            }
        })

        proc.on('error', async (err) => {
            stopPower()
            onProcessEnd()
            updateState({ isDownloading: false })
            logger.error('yt-dlp process encountered error', err)
            await rm(savePath, { force: true }).catch(() => undefined)
            reject(err)
        })

        proc.on('close', async (code) => {
            stopPower()
            onProcessEnd()
            updateState({ isDownloading: false })
            logger.info(`yt-dlp process exited with code ${code}`)
            let finalPath = savePath
            if (!existsSync(finalPath)) {
                logger.warn(
                    `File not found at expected save path (${savePath}). Checking candidate file extensions...`,
                )
                const candidates = [
                    savePath + '.mp4',
                    savePath + '.mkv',
                    savePath + '.webm',
                    savePath.replace(/\.mp4$/i, '.mkv'),
                    savePath.replace(/\.mp4$/i, '.webm'),
                ]
                for (const c of candidates) {
                    if (existsSync(c)) {
                        logger.info(
                            `Found candidate file at ${c}, renaming to ${savePath}`,
                        )
                        await rename(c, savePath).catch(() => {
                            finalPath = c
                        })
                        if (existsSync(savePath)) finalPath = savePath
                        break
                    }
                }
            }

            if (code === 0 && existsSync(finalPath)) {
                logger.info(
                    `Video download successfully completed and verified at ${finalPath}`,
                )
                if (win && !win.isDestroyed()) {
                    win.webContents.send('youtube:progress', {
                        downloadedBytes: 100,
                        totalBytes: 100,
                        percent: 100,
                    })
                }
                resolve({ filePath: finalPath })
            } else {
                logger.error(
                    `Video download failed (exit code ${code}, file verified: ${existsSync(finalPath)})`,
                )
                await rm(savePath, { force: true }).catch(() => undefined)
                const errMsg = buildFailureMessage(
                    stderrLines,
                    rawStderrLines,
                    code,
                )
                logger.error(`Error details: ${errMsg}`)
                reject(new Error(errMsg))
            }
        })
    })
}

export async function downloadYoutubeVideo(
    win: BrowserWindow | null,
    options: DownloadOptions,
    onProcessStart: (proc: any) => void,
    onProcessEnd: () => void,
    updateState: (patch: Partial<ActiveDownloadState>) => void,
    startPower: () => void,
    stopPower: () => void,
): Promise<{ filePath: string; size: number }> {
    const { url, savePath, qualityItag, height, rootDownloadDir } = options
    const logDir =
        rootDownloadDir ||
        (path.dirname(savePath).includes(path.sep)
            ? path.dirname(path.dirname(savePath))
            : path.dirname(savePath))
    const logger = getSessionLogger()
    logger.setDownloadRoot(logDir)

    const downloadLabel = `Single Video Download — ${path.basename(savePath)}`
    logger.startDownload(downloadLabel, {
        url,
        savePath,
        qualityItag,
        height,
    })

    const cleanUrl = url.trim()
    logger.info(
        'Step 1/4: Resolving yt-dlp binary, ffmpeg, and download strategies...',
    )
    const [ytDlpPath, resolvedFfmpegPath, attempts] = await Promise.all([
        ensureYtDlpBinary(false, logger),
        ensureFfmpegBinary(ffmpegPath, logger),
        buildYtDlpAttempts(win, logger),
    ])
    logger.info(`yt-dlp binary located at: ${ytDlpPath}`)
    logger.info(`Strategies: ${attempts.map((a) => a.label).join(' → ')}`)
    const canMerge = Boolean(resolvedFfmpegPath)

    const baseArgs: string[] = ['--newline', '--no-mtime']

    if (resolvedFfmpegPath) {
        baseArgs.push('--ffmpeg-location', resolvedFfmpegPath)
        // Only meaningful with ffmpeg present; without it yt-dlp cannot mux.
        baseArgs.push('--merge-output-format', 'mp4')
        logger.info(`ffmpeg binary located at: ${resolvedFfmpegPath}`)
    } else {
        logger.warn(
            'ffmpeg binary not found. Falling back to a single pre-merged format; quality may be lower than requested.',
        )
    }

    const isAudioOnly =
        qualityItag === -1 || savePath.toLowerCase().endsWith('.mp3')

    if (isAudioOnly) {
        baseArgs.push('-f', 'bestaudio')
        if (canMerge) {
            // Transcoding to mp3 is an ffmpeg postprocessor.
            baseArgs.push('-x', '--audio-format', 'mp3')
        }
    } else {
        const targetHeight =
            height ||
            (typeof qualityItag === 'number' && qualityItag > 0
                ? qualityItag
                : null)
        baseArgs.push('-f', buildVideoFormatSelector(targetHeight, canMerge))
    }

    baseArgs.push('-o', savePath, cleanUrl)

    let lastError: Error | null = null
    let botCheckError: Error | null = null

    for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i]
        logger.info(
            `Download attempt ${i + 1}/${attempts.length}: ${attempt.label}`,
        )
        try {
            const result = await runVideoDownloadAttempt({
                ytDlpPath,
                args: [...attempt.args, ...baseArgs],
                win,
                cleanUrl,
                savePath,
                isAudioOnly,
                logger,
                onProcessStart,
                onProcessEnd,
                updateState,
                startPower,
                stopPower,
            })
            logger.endDownload(downloadLabel, true)
            return { filePath: result.filePath, size: 0 }
        } catch (err: any) {
            const error = err instanceof Error ? err : new Error(String(err))
            lastError = error
            logger.warn(`Attempt "${attempt.label}" failed: ${error.message}`)
            if (!botCheckError && shouldRetryWithAlternative(error.message)) {
                botCheckError = error
            }
            if (!shouldContinueToNextAttempt(error.message)) {
                logger.endDownload(downloadLabel, false)
                throw botCheckError ?? error
            }
        }
    }

    logger.endDownload(downloadLabel, false)
    throw botCheckError ?? lastError ?? new Error('Video download failed')
}
