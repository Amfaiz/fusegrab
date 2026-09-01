/// <reference types="vite/client" />
import type { SaveTarget } from '#/lib/services/files/service'
import type { UpdateState } from '#/lib/services/updater/service'
import type {
    ActiveDownloadState,
    ChannelProgressEvent,
    DownloadChannelOptions,
    DownloadOptions,
    YoutubeChannelInfo,
    YoutubeVideoInfo,
} from '#/lib/services/youtube/service'

declare module 'electron-squirrel-startup' {
    const value: boolean
    export default value
}

declare global {
    interface Window {
        api: {
            updater: {
                getState: () => Promise<UpdateState>
                currentVersion: () => Promise<string>
                check: () => Promise<UpdateState>
                download: () => Promise<UpdateState>
                install: () => Promise<boolean>
                onState: (cb: (state: UpdateState) => void) => () => void
            }
            youtube: {
                getInfo: (url: string) => Promise<YoutubeVideoInfo>
                getQuickInfo: (url: string) => Promise<YoutubeVideoInfo>
                getUrlType: (url: string) => Promise<'video' | 'channel'>
                getChannelPage: (
                    url: string,
                    page?: number,
                    limit?: number,
                ) => Promise<YoutubeChannelInfo>
                download: (
                    options: DownloadOptions,
                ) => Promise<{ filePath: string; size: number }>
                downloadThumbnail: (
                    options: DownloadOptions,
                ) => Promise<{ filePath: string; size: number }>
                downloadChannel: (
                    options: DownloadChannelOptions,
                ) => Promise<void>
                cancelDownload: () => Promise<void>
                openSignIn: () => Promise<void>
                cancelSignIn: () => Promise<void>
                getSignInState: () => Promise<boolean>
                getAccountInfo: () => Promise<{
                    name: string
                    avatarUrl: string | null
                    email: string | null
                } | null>
                signOut: () => Promise<void>
                onSignInState: (
                    cb: (state: {
                        status: 'opened' | 'signed-in' | 'closed' | 'signed-out'
                        url?: string
                    }) => void,
                ) => () => void
                getDownloadState: () => Promise<ActiveDownloadState>
                onProgress: (
                    cb: (progress: {
                        downloadedBytes: number
                        totalBytes: number
                        percent: number
                        speed?: string
                    }) => void,
                ) => () => void
                onChannelProgress: (
                    cb: (progress: ChannelProgressEvent) => void,
                ) => () => void
                onChannelVideoBatch: (
                    cb: (batch: {
                        channelUrl: string
                        channelTitle: string
                        videos: Array<{
                            id: string
                            title: string
                            url: string
                            thumbnail?: string
                            durationSeconds?: number
                            author?: string
                        }>
                        isFirstBatch: boolean
                        isDone: boolean
                    }) => void,
                ) => () => void
            }
        }
        files: {
            pathForFile: (file: File) => string
            chooseSavePath: (target: SaveTarget) => Promise<string | null>
            chooseDirectory: (defaultPath?: string) => Promise<string | null>
            getDefaultDownloadDir: () => Promise<string>
            saveText: (
                target: SaveTarget,
                contents: string,
            ) => Promise<string | null>
            openWrite: (filePath: string) => Promise<number>
            write: (
                id: number,
                position: number,
                data: Uint8Array,
            ) => Promise<void>
            closeWrite: (
                id: number,
                discard?: boolean,
            ) => Promise<{ filePath: string; size: number } | null>
            reveal: (filePath: string) => Promise<boolean>
            deletePartialFile: (filePath: string) => Promise<void>
        }
        store: {
            getSync: <T>(key: string) => T | null
            set: (key: string, value: unknown) => Promise<void>
            flush: () => Promise<void>
        }
        windowControls: {
            platform: NodeJS.Platform
            minimize: () => Promise<void>
            toggleMaximize: () => Promise<void>
            close: () => Promise<void>
            isMaximized: () => Promise<boolean>
            moveBy: (dx: number, dy: number) => Promise<void>
            onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
        }
    }
}

export {}
