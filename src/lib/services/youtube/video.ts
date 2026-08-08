import type {
    ActiveDownloadState,
    DownloadOptions,
    YoutubeFormatInfo,
    YoutubeVideoInfo,
} from './types'
import type { BrowserWindow } from 'electron'

import ffmpegPath from 'ffmpeg-static'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import path from 'node:path'

import { getSessionLogger } from '../logger/service'

import {
    ensureFfmpegBinary,
    ensureYtDlpBinary,
    getAntiRateLimitArgs,
    getJsRuntimeArgs,
    spawnOptions,
} from './binary'
import { buildVideoFormatSelector } from './format'

export async function getYoutubeVideoInfo(
    url: string,
): Promise<YoutubeVideoInfo> {
    const cleanUrl = url.trim()
    if (!cleanUrl) {
        throw new Error('Invalid YouTube video URL')
    }

    const ytDlpPath = await ensureYtDlpBinary()
    const antiRateLimitArgs = await getAntiRateLimitArgs()
    const jsRuntimeArgs = await getJsRuntimeArgs()

    const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
            ytDlpPath,
            [
                ...antiRateLimitArgs,
                ...jsRuntimeArgs,
                '--no-playlist',
                '--dump-single-json',
                cleanUrl,
            ],
            { maxBuffer: 50 * 1024 * 1024 },
            (err, out) => {
                if (err)
                    return reject(
                        new Error(
                            err.message || 'Failed to fetch YouTube video info',
                        ),
                    )
                resolve(out)
            },
        )
    })

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
    logger.info('Step 1/4: Resolving yt-dlp binary...')
    const ytDlpPath = await ensureYtDlpBinary(false, logger)
    logger.info(`yt-dlp binary located at: ${ytDlpPath}`)

    logger.info('Step 2/4: Fetching anti-rate-limit parameters...')
    const antiRateLimitArgs = await getAntiRateLimitArgs(win, logger)
    logger.info(
        `Anti-rate-limit arguments: ${JSON.stringify(antiRateLimitArgs)}`,
    )

    const resolvedFfmpegPath = await ensureFfmpegBinary(ffmpegPath, logger)
    const canMerge = Boolean(resolvedFfmpegPath)

    const args: string[] = [
        ...antiRateLimitArgs,
        ...(await getJsRuntimeArgs(logger)),
        '--newline',
        '--no-mtime',
    ]

    if (resolvedFfmpegPath) {
        args.push('--ffmpeg-location', resolvedFfmpegPath)
        // Only meaningful with ffmpeg present; without it yt-dlp cannot mux.
        args.push('--merge-output-format', 'mp4')
        logger.info(`ffmpeg binary located at: ${resolvedFfmpegPath}`)
    } else {
        logger.warn(
            'ffmpeg binary not found. Falling back to a single pre-merged format; quality may be lower than requested.',
        )
    }

    const isAudioOnly =
        qualityItag === -1 || savePath.toLowerCase().endsWith('.mp3')

    if (isAudioOnly) {
        args.push('-f', 'bestaudio')
        if (canMerge) {
            // Transcoding to mp3 is an ffmpeg postprocessor.
            args.push('-x', '--audio-format', 'mp3')
        }
    } else {
        const targetHeight =
            height ||
            (typeof qualityItag === 'number' && qualityItag > 0
                ? qualityItag
                : null)
        args.push('-f', buildVideoFormatSelector(targetHeight, canMerge))
    }

    args.push('-o', savePath, cleanUrl)

    logger.info(`Step 3/4: Command args constructed: ${args.join(' ')}`)
    logger.info(`Step 4/4: Spawning yt-dlp child process...`)

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

    // Weighted multi-stream progress tracking
    // Video+audio downloads report two separate 0-100% streams.
    // We weight them: stream 1 (video) = 0-80%, stream 2 (audio) = 80-95%,
    // merge/finalize = 95-100%. For audio-only: single stream = 0-100%.
    let currentStream = 0
    let lastRawPercent = 0
    let maxEmittedPercent = 0

    const streamWeights = isAudioOnly
        ? [{ start: 0, end: 100 }]
        : [
              { start: 0, end: 80 }, // video stream
              { start: 80, end: 95 }, // audio stream
          ]

    const computeWeightedPercent = (rawPercent: number): number => {
        const streamIndex = Math.min(currentStream, streamWeights.length - 1)
        const weight = streamWeights[streamIndex]
        const mapped =
            weight.start + (rawPercent / 100) * (weight.end - weight.start)
        return Math.max(maxEmittedPercent, Math.min(95, mapped))
    }

    function parsePercentFromLine(line: string): number | null {
        const ytDlpMatch = line.match(/\[download\]\s+([\d.]+)%/)
        if (ytDlpMatch) {
            const val = parseFloat(ytDlpMatch[1])
            return isNaN(val) ? null : val
        }

        const aria2Match =
            line.match(/\[#\w+.*?\(([\d.]+)%\)/) ||
            line.match(/\[#\w+.*?\s+([\d.]+)%/)
        if (aria2Match) {
            const val = parseFloat(aria2Match[1])
            return isNaN(val) ? null : val
        }

        return null
    }

    return new Promise((resolve, reject) => {
        proc.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n')
            for (const line of lines) {
                logger.logStdoutLine(line)

                // Detect stream switch via "Destination:" line
                if (line.includes('[download] Destination:')) {
                    if (currentStream > 0 || lastRawPercent > 50) {
                        currentStream++
                    }
                    lastRawPercent = 0
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

                const rawPercent = parsePercentFromLine(line)
                if (rawPercent !== null) {
                    // Detect stream switch via large percent drop
                    if (
                        rawPercent < lastRawPercent - 20 &&
                        lastRawPercent > 50
                    ) {
                        currentStream++
                    }
                    lastRawPercent = rawPercent

                    const weightedPercent = computeWeightedPercent(rawPercent)
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
            if (!str.includes('WARNING:')) {
                stderrLines.push(str.trim())
            }
        })

        proc.on('error', async (err) => {
            stopPower()
            onProcessEnd()
            updateState({ isDownloading: false })
            logger.error('yt-dlp process encountered error', err)
            logger.endDownload(downloadLabel, false)
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
                logger.endDownload(downloadLabel, true)
                if (win && !win.isDestroyed()) {
                    win.webContents.send('youtube:progress', {
                        downloadedBytes: 100,
                        totalBytes: 100,
                        percent: 100,
                    })
                }
                resolve({ filePath: finalPath, size: 0 })
            } else {
                logger.error(
                    `Video download failed (exit code ${code}, file verified: ${existsSync(finalPath)})`,
                )
                await rm(savePath, { force: true }).catch(() => undefined)
                const errMsg =
                    stderrLines.length > 0
                        ? stderrLines.slice(-3).join(' ')
                        : `Video download failed with exit code ${code}`
                logger.error(`Error details: ${errMsg}`)
                logger.endDownload(downloadLabel, false)
                reject(new Error(errMsg))
            }
        })
    })
}
