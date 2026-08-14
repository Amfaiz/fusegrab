import type { SessionLogger } from '../logger/service'
import type {
    ActiveDownloadState,
    ChannelProgressEvent,
    DownloadChannelOptions,
    YoutubeChannelInfo,
    YoutubeChannelVideoItem,
} from './types'
import type { BrowserWindow } from 'electron'

import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { getSessionLogger } from '../logger/service'

import { ensureFfmpegBinary, ensureYtDlpBinary, spawnOptions } from './binary'
import { scrapeChannelWithBrowser } from './channel-scraper'
import { buildVideoFormatSelector } from './format'
import { isHlsStartGlitch, parseYtDlpSpeed } from './progress'
import {
    buildFailureMessage,
    buildYtDlpAttempts,
    runJsonAttempts,
    shouldContinueToNextAttempt,
    shouldRetryWithAlternative,
} from './retry'

export async function getYoutubeUrlType(
    url: string,
): Promise<'video' | 'channel'> {
    const cleanUrl = url.trim()
    if (!cleanUrl) {
        throw new Error('Invalid YouTube URL')
    }

    if (
        cleanUrl.includes('/watch?v=') ||
        cleanUrl.includes('watch?v=') ||
        cleanUrl.includes('v=') ||
        cleanUrl.includes('youtu.be/') ||
        cleanUrl.includes('/shorts/')
    ) {
        return 'video'
    }

    if (
        cleanUrl.includes('/@') ||
        cleanUrl.includes('/channel/') ||
        cleanUrl.includes('/c/') ||
        cleanUrl.includes('/user/') ||
        cleanUrl.includes('list=')
    ) {
        return 'channel'
    }

    const [ytDlpPath, attempts] = await Promise.all([
        ensureYtDlpBinary(),
        buildYtDlpAttempts(),
    ])
    try {
        const stdout = await runJsonAttempts(ytDlpPath, attempts, [
            '--dump-single-json',
            '--flat-playlist',
            '--playlist-start',
            '1',
            '--playlist-end',
            '1',
            cleanUrl,
        ])

        const data = JSON.parse(stdout)
        if (
            data._type === 'playlist' ||
            Array.isArray(data.entries) ||
            data.playlist_count
        ) {
            return 'channel'
        }
    } catch {}

    return 'video'
}

export async function getYoutubeChannelPage(
    win: BrowserWindow | null,
    url: string,
    page = 1,
    limit = 10000,
): Promise<YoutubeChannelInfo> {
    const cleanUrl = url.trim()
    if (!cleanUrl) {
        throw new Error('Invalid YouTube channel URL')
    }

    const skipCount = (page - 1) * limit
    const targetNeeded = 10000

    const result = await scrapeChannelWithBrowser(
        cleanUrl,
        targetNeeded,
        (batch) => {
            if (win && !win.isDestroyed()) {
                win.webContents.send('youtube:channel-video-batch', batch)
            }
        },
    )

    if (result && result.videos.length > 0) {
        const pageVideos = result.videos.slice(skipCount, skipCount + limit)
        return {
            id: cleanUrl,
            title: result.channelTitle || 'YouTube Channel',
            author: result.channelTitle || 'YouTube',
            totalVideos: result.videos.length,
            videos: pageVideos,
            hasMore: result.hasMore,
            nextPage: page + 1,
        }
    }

    const fallback = await getChannelPageViaYtDlp(cleanUrl, page, 10000)
    if (win && !win.isDestroyed() && fallback.videos.length > 0) {
        win.webContents.send('youtube:channel-video-batch', {
            channelUrl: cleanUrl,
            channelTitle: fallback.title || 'YouTube Playlist',
            videos: fallback.videos,
            isFirstBatch: true,
            isDone: true,
        })
    }
    return fallback
}

async function getChannelPageViaYtDlp(
    url: string,
    page: number,
    limit: number,
): Promise<YoutubeChannelInfo> {
    const start = (page - 1) * limit + 1
    const end = page * limit

    const [ytDlpPath, attempts] = await Promise.all([
        ensureYtDlpBinary(),
        buildYtDlpAttempts(),
    ])
    const stdout = await runJsonAttempts(ytDlpPath, attempts, [
        '--dump-single-json',
        '--flat-playlist',
        '--playlist-start',
        String(start),
        '--playlist-end',
        String(end),
        url,
    ])

    const data = JSON.parse(stdout)
    const rawEntries = Array.isArray(data.entries) ? data.entries : []
    const totalVideos =
        data.playlist_count || data.n_entries || rawEntries.length

    const videos: YoutubeChannelVideoItem[] = rawEntries.map((e: any) => {
        const videoId = e.id || e.url?.replace(/.*v=/, '') || ''
        let thumb = ''
        if (Array.isArray(e.thumbnails) && e.thumbnails.length > 0) {
            thumb = e.thumbnails[e.thumbnails.length - 1].url
        } else if (videoId) {
            thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        }

        const videoUrl = e.url
            ? e.url.startsWith('http')
                ? e.url
                : `https://www.youtube.com/watch?v=${e.url}`
            : `https://www.youtube.com/watch?v=${videoId}`

        return {
            id: videoId,
            title: e.title || 'Untitled Video',
            url: videoUrl,
            thumbnail: thumb,
            durationSeconds: Math.round(e.duration || 0),
            author:
                e.uploader ||
                e.channel ||
                data.uploader ||
                data.channel ||
                data.title ||
                'YouTube',
        }
    })

    const hasMore = rawEntries.length >= limit || totalVideos > end

    return {
        id: data.id || url,
        title: data.title || data.uploader || 'YouTube Channel',
        author: data.uploader || data.channel || 'YouTube',
        totalVideos: totalVideos || videos.length,
        videos,
        hasMore,
        nextPage: page + 1,
    }
}

interface ChannelAttemptDeps {
    ytDlpPath: string
    args: string[]
    win: BrowserWindow | null
    cleanUrl: string
    logger: SessionLogger
    onProcessStart: (proc: any) => void
    onProcessEnd: () => void
    updateState: (patch: Partial<ActiveDownloadState>) => void
    startPower: () => void
    stopPower: () => void
}

/**
 * One yt-dlp spawn for a channel/playlist download. Per-item progress is
 * streamed to the renderer; the promise resolves on exit code 0 or rejects
 * with a message derived from yt-dlp's stderr.
 */
async function runChannelDownloadAttempt(
    deps: ChannelAttemptDeps,
): Promise<void> {
    const {
        ytDlpPath,
        args,
        win,
        cleanUrl,
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
        downloadType: 'channel',
        url: cleanUrl,
        progress: null,
        channelProgress: {
            currentItem: 0,
            totalItems: 0,
            percent: 0,
            status: 'downloading',
        },
    })

    const proc = spawn(ytDlpPath, args, spawnOptions())
    onProcessStart(proc)
    logger.info(`yt-dlp child process spawned with PID ${proc.pid}`)

    let currentItem = 0
    let totalItems = 0
    let videoTitle = ''
    let currentSpeed: string | undefined = undefined
    const stderrLines: string[] = []
    const rawStderrLines: string[] = []

    return new Promise((resolve, reject) => {
        proc.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n')
            for (const line of lines) {
                logger.logStdoutLine(line)

                const itemMatch = line.match(
                    /\[download\]\s+Downloading\s+(?:item|video)\s+(\d+)\s+of\s+(\d+)/i,
                )
                if (itemMatch) {
                    currentItem = parseInt(itemMatch[1], 10)
                    totalItems = parseInt(itemMatch[2], 10)
                    currentSpeed = undefined
                    logger.info(
                        `Downloading item ${currentItem} of ${totalItems}`,
                    )
                }

                const destMatch = line.match(
                    /\[download\]\s+Destination:\s+(.+)/i,
                )
                if (destMatch) {
                    videoTitle = path.basename(destMatch[1])
                    currentSpeed = undefined
                    logger.info(`Target destination: ${videoTitle}`)
                }

                const speed = parseYtDlpSpeed(line)
                if (speed) {
                    currentSpeed = speed
                }

                const ytDlpPercent = line.match(/\[download\]\s+([\d.]+)%/)
                const aria2Percent =
                    line.match(/\[#\w+.*?\(([\d.]+)%\)/) ||
                    line.match(/\[#\w+.*?\s+([\d.]+)%/)
                const percentMatch = ytDlpPercent || aria2Percent

                if (percentMatch && !isHlsStartGlitch(line)) {
                    const percent = parseFloat(percentMatch[1])
                    if (!isNaN(percent)) {
                        const cp: ChannelProgressEvent = {
                            currentItem,
                            totalItems,
                            percent: Math.min(100, percent),
                            speed: currentSpeed,
                            videoTitle,
                            status: 'downloading',
                        }
                        updateState({ channelProgress: cp })
                        if (win && !win.isDestroyed()) {
                            win.webContents.send('youtube:channel-progress', cp)
                        }
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
            logger.error('yt-dlp channel process encountered error', err)
            reject(err)
        })

        proc.on('close', async (code) => {
            stopPower()
            onProcessEnd()
            updateState({ isDownloading: false })
            logger.info(`yt-dlp process exited with code ${code}`)
            if (code === 0) {
                logger.info('Channel download successfully completed.')
                if (win && !win.isDestroyed()) {
                    win.webContents.send('youtube:channel-progress', {
                        currentItem: totalItems || currentItem,
                        totalItems: totalItems || currentItem,
                        percent: 100,
                        videoTitle,
                        status: 'completed',
                    } satisfies ChannelProgressEvent)
                }
                resolve()
            } else {
                const errMsg = buildFailureMessage(
                    stderrLines,
                    rawStderrLines,
                    code,
                )
                logger.error(`Channel download failed: ${errMsg}`)
                reject(new Error(errMsg))
            }
        })
    })
}

export async function downloadYoutubeChannel(
    win: BrowserWindow | null,
    options: DownloadChannelOptions,
    onProcessStart: (proc: any) => void,
    onProcessEnd: () => void,
    updateState: (patch: Partial<ActiveDownloadState>) => void,
    startPower: () => void,
    stopPower: () => void,
): Promise<void> {
    const {
        channelUrl,
        saveDir,
        qualityHeight,
        isAudioOnly,
        isThumbnail,
        downloadThumbnail,
        rootDownloadDir,
    } = options
    const logDir = rootDownloadDir || path.dirname(saveDir)
    const logger = getSessionLogger()
    logger.setDownloadRoot(logDir)

    const downloadLabel = `Channel/Playlist Download — ${path.basename(saveDir)}`
    logger.startDownload(downloadLabel, {
        channelUrl,
        saveDir,
        qualityHeight,
        isAudioOnly,
        isThumbnail,
        downloadThumbnail,
    })

    const cleanUrl = channelUrl.trim()
    if (!existsSync(saveDir)) {
        logger.info(`Creating target save directory: ${saveDir}`)
        mkdirSync(saveDir, { recursive: true })
    }

    logger.info(
        'Step 1/3: Resolving yt-dlp binary, ffmpeg, and download strategies...',
    )
    const [ytDlpPath, resolvedFfmpegPath, attempts] = await Promise.all([
        ensureYtDlpBinary(false, logger),
        ensureFfmpegBinary(ffmpegPath, logger),
        buildYtDlpAttempts(win, logger),
    ])
    logger.info(`yt-dlp binary located at: ${ytDlpPath}`)
    logger.info(`Strategies: ${attempts.map((a) => a.label).join(' → ')}`)
    const canMerge = Boolean(resolvedFfmpegPath)

    const baseArgs: string[] = [
        '--newline',
        '--no-mtime',
        '--sleep-requests',
        '1',
        '--sleep-interval',
        '2',
        '--max-sleep-interval',
        '5',
    ]

    if (resolvedFfmpegPath) {
        baseArgs.push('--ffmpeg-location', resolvedFfmpegPath)
        if (isThumbnail || downloadThumbnail) {
            // yt-dlp downloads YouTube thumbnails as webp; convert to jpg so
            // the files open anywhere.
            baseArgs.push('--convert-thumbnails', 'jpg')
        }
        if (!isThumbnail) {
            // Only meaningful with ffmpeg present; without it yt-dlp cannot mux.
            baseArgs.push('--merge-output-format', 'mp4')
        }
        logger.info(`ffmpeg binary located at: ${resolvedFfmpegPath}`)
    } else {
        logger.warn(
            'ffmpeg binary not found. Falling back to a single pre-merged format; quality may be lower than requested.',
        )
    }

    if (isThumbnail) {
        // Thumbnails only: no media download, yt-dlp picks the highest
        // resolution thumbnail available for each video.
        baseArgs.push('--skip-download', '--write-thumbnail')
    } else {
        if (downloadThumbnail) {
            // Companion thumbnail per video, written alongside the media by
            // the same yt-dlp run. yt-dlp picks the highest resolution
            // thumbnail available for each video.
            baseArgs.push('--write-thumbnail')
        }
        if (isAudioOnly) {
            baseArgs.push('-f', 'bestaudio')
            if (canMerge) {
                // Transcoding to mp3 is an ffmpeg postprocessor.
                baseArgs.push('-x', '--audio-format', 'mp3')
            }
        } else if (qualityHeight) {
            baseArgs.push(
                '-f',
                buildVideoFormatSelector(qualityHeight, canMerge),
            )
        } else {
            baseArgs.push('-f', buildVideoFormatSelector(undefined, canMerge))
        }
    }

    // %(ext)s makes yt-dlp substitute each thumbnail's real extension (webp),
    // which the convert-thumbnails postprocessor then replaces with jpg — so
    // converted files land with a single .jpg extension.
    const outputTemplate = path.join(saveDir, '%(title)s [%(id)s].%(ext)s')
    baseArgs.push('-o', outputTemplate, cleanUrl)

    logger.info(`Output template: ${outputTemplate}`)

    let lastError: Error | null = null
    let botCheckError: Error | null = null

    for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i]
        logger.info(
            `Download attempt ${i + 1}/${attempts.length}: ${attempt.label}`,
        )
        try {
            await runChannelDownloadAttempt({
                ytDlpPath,
                args: [...attempt.args, ...baseArgs],
                win,
                cleanUrl,
                logger,
                onProcessStart,
                onProcessEnd,
                updateState,
                startPower,
                stopPower,
            })
            logger.endDownload(downloadLabel, true)
            return
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
    throw botCheckError ?? lastError ?? new Error('Channel download failed')
}
