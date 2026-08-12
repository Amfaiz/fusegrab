import type { SessionLogger } from '../logger/service'
import type { ActiveDownloadState, DownloadOptions } from './types'
import type { BrowserWindow } from 'electron'

import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import path from 'node:path'

import { getSessionLogger } from '../logger/service'

import { ensureFfmpegBinary, ensureYtDlpBinary, spawnOptions } from './binary'
import {
    buildFailureMessage,
    buildYtDlpAttempts,
    shouldContinueToNextAttempt,
    shouldRetryWithAlternative,
} from './retry'

async function rmThumbnailFiles(savePath: string): Promise<void> {
    await rm(savePath, { force: true }).catch(() => undefined)
    await rm(savePath.replace(/\.jpg$/i, '.webp'), {
        force: true,
    }).catch(() => undefined)
    await rm(savePath.replace(/\.jpg$/i, '.png'), {
        force: true,
    }).catch(() => undefined)
}

interface ThumbnailAttemptDeps {
    ytDlpPath: string
    args: string[]
    win: BrowserWindow | null
    cleanUrl: string
    savePath: string
    logger: SessionLogger
    onProcessStart: (proc: any) => void
    onProcessEnd: () => void
    updateState: (patch: Partial<ActiveDownloadState>) => void
    startPower: () => void
    stopPower: () => void
}

/**
 * One yt-dlp spawn for a single thumbnail download. Thumbnails are small, so
 * no percent parsing is needed — the promise resolves with the verified output
 * path or rejects with a message derived from yt-dlp's stderr.
 */
async function runThumbnailDownloadAttempt(
    deps: ThumbnailAttemptDeps,
): Promise<{ filePath: string }> {
    const {
        ytDlpPath,
        args,
        win,
        cleanUrl,
        savePath,
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

    return new Promise((resolve, reject) => {
        proc.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n')
            for (const line of lines) {
                logger.logStdoutLine(line)
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
            logger.error('yt-dlp thumbnail process encountered error', err)
            await rmThumbnailFiles(savePath)
            reject(err)
        })

        proc.on('close', async (code) => {
            stopPower()
            onProcessEnd()
            updateState({ isDownloading: false })
            logger.info(`yt-dlp process exited with code ${code}`)
            let finalPath = savePath
            if (!existsSync(finalPath)) {
                // Without ffmpeg there is no jpg conversion, so yt-dlp writes
                // the thumbnail with its actual extension (webp/png) instead.
                logger.warn(
                    `File not found at expected save path (${savePath}). Checking candidate file extensions...`,
                )
                const candidates = [
                    savePath.replace(/\.jpg$/i, '.webp'),
                    savePath.replace(/\.jpg$/i, '.png'),
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
                    `Thumbnail download successfully completed and verified at ${finalPath}`,
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
                    `Thumbnail download failed (exit code ${code}, file verified: ${existsSync(finalPath)})`,
                )
                await rmThumbnailFiles(savePath)
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

export async function downloadYoutubeThumbnail(
    win: BrowserWindow | null,
    options: DownloadOptions,
    onProcessStart: (proc: any) => void,
    onProcessEnd: () => void,
    updateState: (patch: Partial<ActiveDownloadState>) => void,
    startPower: () => void,
    stopPower: () => void,
): Promise<{ filePath: string; size: number }> {
    const { url, savePath, rootDownloadDir } = options
    const logDir =
        rootDownloadDir ||
        (path.dirname(savePath).includes(path.sep)
            ? path.dirname(path.dirname(savePath))
            : path.dirname(savePath))
    const logger = getSessionLogger()
    logger.setDownloadRoot(logDir)

    const downloadLabel = `Thumbnail Download — ${path.basename(savePath)}`
    logger.startDownload(downloadLabel, { url, savePath })

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

    const baseArgs: string[] = [
        '--newline',
        '--no-playlist',
        '--skip-download',
        '--write-thumbnail',
    ]

    if (resolvedFfmpegPath) {
        baseArgs.push('--ffmpeg-location', resolvedFfmpegPath)
        // yt-dlp downloads YouTube thumbnails as webp; convert to jpg so the
        // file opens anywhere.
        baseArgs.push('--convert-thumbnails', 'jpg')
        logger.info(`ffmpeg binary located at: ${resolvedFfmpegPath}`)
    } else {
        logger.warn(
            'ffmpeg binary not found. Thumbnail may be saved as webp/png instead of jpg.',
        )
    }

    // %(ext)s makes yt-dlp substitute the thumbnail's real extension (webp),
    // which the convert-thumbnails postprocessor then replaces with jpg — so
    // the final file lands exactly at savePath instead of a double extension.
    baseArgs.push('-o', savePath.replace(/\.jpg$/i, '.%(ext)s'), cleanUrl)

    let lastError: Error | null = null
    let botCheckError: Error | null = null

    for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i]
        logger.info(
            `Download attempt ${i + 1}/${attempts.length}: ${attempt.label}`,
        )
        try {
            const result = await runThumbnailDownloadAttempt({
                ytDlpPath,
                args: [...attempt.args, ...baseArgs],
                win,
                cleanUrl,
                savePath,
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
    throw botCheckError ?? lastError ?? new Error('Thumbnail download failed')
}
