import type {
    ActiveDownloadState,
    DownloadChannelOptions,
    DownloadOptions,
    YoutubeChannelInfo,
    YoutubeVideoInfo,
} from './types'
import type { BrowserWindow } from 'electron'
import type { ChildProcess } from 'node:child_process'

import { powerSaveBlocker } from 'electron'
import { execFile } from 'node:child_process'

import {
    downloadYoutubeChannel as downloadChannelImpl,
    getYoutubeChannelPage as getChannelPageImpl,
    getYoutubeUrlType as getUrlTypeImpl,
} from './channel'
import { downloadYoutubeThumbnail as downloadThumbnailImpl } from './thumbnail'
import {
    downloadYoutubeVideo as downloadVideoImpl,
    getYoutubeVideoInfo as getVideoInfoImpl,
} from './video'

export type {
    ActiveDownloadState,
    ChannelProgressEvent,
    DownloadChannelOptions,
    DownloadOptions,
    YoutubeChannelInfo,
    YoutubeChannelVideoItem,
    YoutubeFormatInfo,
    YoutubeVideoInfo,
} from './types'

export { destroyScraperWindows } from './channel-scraper'
export { prewarmYoutubeBinaries } from './binary'
export { openYoutubeSignIn } from './sign-in'
export {
    areAllValidYoutubeUrls,
    getInvalidYoutubeUrls,
    isValidYoutubeUrl,
    parseYoutubeUrls,
} from './url'

// A video download may run a companion thumbnail download in parallel, so
// cancel must kill every active yt-dlp child process, not just one.
let activeChildProcesses = new Set<ChildProcess>()
let powerBlockerId: number | null = null
let powerBlockerCount = 0

let activeDownloadState: ActiveDownloadState = {
    isDownloading: false,
    downloadType: null,
    url: null,
    progress: null,
    channelProgress: null,
}

export function getActiveDownloadState(): ActiveDownloadState {
    return activeDownloadState
}

function updateState(patch: Partial<ActiveDownloadState>) {
    activeDownloadState = { ...activeDownloadState, ...patch }
}

// Parallel downloads each start/stop the blocker; refcount so the blocker
// stays active until every concurrent process has finished.
function startPowerBlocker() {
    if (powerBlockerCount === 0) {
        try {
            powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
        } catch {
            powerBlockerId = null
        }
    }
    powerBlockerCount++
}

function stopPowerBlocker() {
    if (powerBlockerCount > 0) {
        powerBlockerCount--
    }
    if (powerBlockerCount === 0 && powerBlockerId !== null) {
        try {
            if (powerSaveBlocker.isStarted(powerBlockerId)) {
                powerSaveBlocker.stop(powerBlockerId)
            }
        } catch {}
        powerBlockerId = null
    }
}

function registerActiveProcess(proc: ChildProcess) {
    activeChildProcesses.add(proc)
    proc.once('close', () => {
        activeChildProcesses.delete(proc)
    })
}

export function cancelYoutubeDownload() {
    powerBlockerCount = 0
    stopPowerBlocker()
    for (const proc of activeChildProcesses) {
        const pid = proc.pid
        if (pid) {
            if (process.platform === 'win32') {
                try {
                    execFile('taskkill', ['/F', '/T', '/PID', String(pid)], {
                        windowsHide: true,
                    })
                } catch {}
            } else {
                try {
                    process.kill(-pid, 'SIGKILL')
                } catch {
                    try {
                        proc.kill('SIGKILL')
                    } catch {}
                }
            }
        }
    }
    activeChildProcesses.clear()
    activeDownloadState = {
        isDownloading: false,
        downloadType: null,
        url: null,
        progress: null,
        channelProgress: null,
    }
}

export async function getYoutubeUrlType(
    url: string,
): Promise<'video' | 'channel'> {
    return getUrlTypeImpl(url)
}

export async function getYoutubeChannelPage(
    win: BrowserWindow | null,
    url: string,
    page = 1,
    limit = 20,
): Promise<YoutubeChannelInfo> {
    return getChannelPageImpl(win, url, page, limit)
}

export async function getYoutubeVideoInfo(
    url: string,
    win?: BrowserWindow | null,
): Promise<YoutubeVideoInfo> {
    return getVideoInfoImpl(url, win)
}

export async function downloadYoutubeVideo(
    win: BrowserWindow | null,
    options: DownloadOptions,
): Promise<{ filePath: string; size: number }> {
    cancelYoutubeDownload()
    const videoPromise = downloadVideoImpl(
        win,
        options,
        (proc) => {
            registerActiveProcess(proc)
        },
        () => {},
        updateState,
        startPowerBlocker,
        stopPowerBlocker,
    )

    let thumbnailPromise: Promise<unknown> = Promise.resolve()
    if (options.downloadThumbnail) {
        // Companion thumbnail next to the video file (same name, .jpg).
        const thumbnailSavePath = options.savePath.replace(/\.[^.]+$/, '.jpg')
        thumbnailPromise = downloadThumbnailImpl(
            null,
            { url: options.url, savePath: thumbnailSavePath },
            (proc) => {
                registerActiveProcess(proc)
            },
            () => {},
            // The video download owns the shared state and progress events;
            // the thumbnail run stays silent so it cannot fight the UI.
            () => {},
            startPowerBlocker,
            stopPowerBlocker,
        ).catch((err: any) => {
            console.error(
                `Thumbnail download failed (video download continues): ${err?.message || err}`,
            )
        })
    }

    // The video's result decides the item's fate; a thumbnail hiccup must
    // never fail an otherwise successful video download.
    const [videoResult] = await Promise.all([videoPromise, thumbnailPromise])
    return videoResult
}

export async function downloadYoutubeThumbnail(
    win: BrowserWindow | null,
    options: DownloadOptions,
): Promise<{ filePath: string; size: number }> {
    cancelYoutubeDownload()
    return downloadThumbnailImpl(
        win,
        options,
        (proc) => {
            registerActiveProcess(proc)
        },
        () => {},
        updateState,
        startPowerBlocker,
        stopPowerBlocker,
    )
}

export async function downloadYoutubeChannel(
    win: BrowserWindow | null,
    options: DownloadChannelOptions,
): Promise<void> {
    cancelYoutubeDownload()
    return downloadChannelImpl(
        win,
        options,
        (proc) => {
            registerActiveProcess(proc)
        },
        () => {},
        updateState,
        startPowerBlocker,
        stopPowerBlocker,
    )
}
