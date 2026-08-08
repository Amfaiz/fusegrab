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

let activeChildProcess: ChildProcess | null = null
let powerBlockerId: number | null = null

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

function startPowerBlocker() {
    if (powerBlockerId === null) {
        try {
            powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
        } catch {
            powerBlockerId = null
        }
    }
}

function stopPowerBlocker() {
    if (powerBlockerId !== null) {
        try {
            if (powerSaveBlocker.isStarted(powerBlockerId)) {
                powerSaveBlocker.stop(powerBlockerId)
            }
        } catch {}
        powerBlockerId = null
    }
}

export function cancelYoutubeDownload() {
    stopPowerBlocker()
    if (activeChildProcess) {
        const pid = activeChildProcess.pid
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
                        activeChildProcess.kill('SIGKILL')
                    } catch {}
                }
            }
        }
        activeChildProcess = null
    }
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
): Promise<YoutubeVideoInfo> {
    return getVideoInfoImpl(url)
}

export async function downloadYoutubeVideo(
    win: BrowserWindow | null,
    options: DownloadOptions,
): Promise<{ filePath: string; size: number }> {
    cancelYoutubeDownload()
    return downloadVideoImpl(
        win,
        options,
        (proc) => {
            activeChildProcess = proc
        },
        () => {
            activeChildProcess = null
        },
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
            activeChildProcess = proc
        },
        () => {
            activeChildProcess = null
        },
        updateState,
        startPowerBlocker,
        stopPowerBlocker,
    )
}
