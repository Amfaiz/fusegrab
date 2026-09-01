import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('files', {
    // Electron 32 removed the non-standard `File.path`; this is the sanctioned
    // replacement. The tools need the real path of a dropped/picked file to
    // suggest an output location next to the original.
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    chooseSavePath: (target: unknown) =>
        ipcRenderer.invoke('files:choose-save-path', target) as Promise<
            string | null
        >,
    chooseDirectory: (defaultPath?: string) =>
        ipcRenderer.invoke('files:choose-directory', defaultPath) as Promise<
            string | null
        >,
    getDefaultDownloadDir: () =>
        ipcRenderer.invoke('files:get-default-dir') as Promise<string>,
    saveText: (target: unknown, contents: string) =>
        ipcRenderer.invoke('files:save-text', target, contents) as Promise<
            string | null
        >,
    openWrite: (filePath: string) =>
        ipcRenderer.invoke('files:open-write', filePath) as Promise<number>,
    write: (id: number, position: number, data: Uint8Array) =>
        ipcRenderer.invoke('files:write', id, position, data) as Promise<void>,
    closeWrite: (id: number, discard = false) =>
        ipcRenderer.invoke('files:close-write', id, discard) as Promise<{
            filePath: string
            size: number
        } | null>,
    reveal: (filePath: string) =>
        ipcRenderer.invoke('files:reveal', filePath) as Promise<boolean>,
    deletePartialFile: (filePath: string) =>
        ipcRenderer.invoke('files:delete-partial', filePath) as Promise<void>,
})

contextBridge.exposeInMainWorld('api', {
    updater: {
        getState: () => ipcRenderer.invoke('updater:get-state'),
        currentVersion: () =>
            ipcRenderer.invoke('app:get-version') as Promise<string>,
        check: () => ipcRenderer.invoke('updater:check'),
        download: () => ipcRenderer.invoke('updater:download'),
        install: () =>
            ipcRenderer.invoke('updater:install') as Promise<boolean>,
        onState: (cb: (state: any) => void) => {
            const handler = (_: unknown, state: unknown) => cb(state)
            ipcRenderer.on('updater:state', handler)
            return () => {
                ipcRenderer.off('updater:state', handler)
            }
        },
    },
    youtube: {
        getInfo: (url: string) => ipcRenderer.invoke('youtube:get-info', url),
        getQuickInfo: (url: string) =>
            ipcRenderer.invoke('youtube:get-quick-info', url),
        getUrlType: (url: string) =>
            ipcRenderer.invoke('youtube:get-url-type', url) as Promise<
                'video' | 'channel'
            >,
        getChannelPage: (url: string, page?: number, limit?: number) =>
            ipcRenderer.invoke('youtube:get-channel-page', url, page, limit),
        download: (options: {
            url: string
            savePath: string
            qualityItag?: number
            height?: number
            rootDownloadDir?: string
            downloadThumbnail?: boolean
            section?: {
                startSeconds: number
                endSeconds: number
            }
        }) => ipcRenderer.invoke('youtube:download', options),
        downloadThumbnail: (options: {
            url: string
            savePath: string
            rootDownloadDir?: string
        }) => ipcRenderer.invoke('youtube:download-thumbnail', options),
        downloadChannel: (options: {
            channelUrl: string
            saveDir: string
            qualityHeight?: number
            isAudioOnly?: boolean
            isThumbnail?: boolean
            downloadThumbnail?: boolean
            rootDownloadDir?: string
        }) => ipcRenderer.invoke('youtube:download-channel', options),
        cancelDownload: () => ipcRenderer.invoke('youtube:cancel-download'),
        openSignIn: () => ipcRenderer.invoke('youtube:open-sign-in'),
        cancelSignIn: () => ipcRenderer.invoke('youtube:cancel-sign-in'),
        getSignInState: () =>
            ipcRenderer.invoke('youtube:get-sign-in-state') as Promise<boolean>,
        getAccountInfo: () =>
            ipcRenderer.invoke('youtube:get-account-info') as Promise<{
                name: string
                avatarUrl: string | null
                email: string | null
            } | null>,
        signOut: () => ipcRenderer.invoke('youtube:sign-out') as Promise<void>,
        onSignInState: (
            cb: (state: {
                status: 'opened' | 'signed-in' | 'closed' | 'signed-out'
                /** Present when status is 'opened': load this in the webview. */
                url?: string
            }) => void,
        ) => {
            const handler = (_: unknown, state: unknown) => cb(state as any)
            ipcRenderer.on('youtube:sign-in-state', handler)
            return () => {
                ipcRenderer.off('youtube:sign-in-state', handler)
            }
        },
        getDownloadState: () =>
            ipcRenderer.invoke('youtube:get-download-state'),
        onProgress: (
            cb: (progress: {
                downloadedBytes: number
                totalBytes: number
                percent: number
                speed?: string
            }) => void,
        ) => {
            const handler = (_: unknown, progress: any) => cb(progress)
            ipcRenderer.on('youtube:progress', handler)
            return () => {
                ipcRenderer.off('youtube:progress', handler)
            }
        },
        onChannelProgress: (
            cb: (progress: {
                currentItem: number
                totalItems: number
                percent: number
                speed?: string
                videoTitle?: string
                status: 'downloading' | 'completed' | 'cancelled' | 'error'
            }) => void,
        ) => {
            const handler = (_: unknown, progress: any) => cb(progress)
            ipcRenderer.on('youtube:channel-progress', handler)
            return () => {
                ipcRenderer.off('youtube:channel-progress', handler)
            }
        },
        onChannelVideoBatch: (cb: (batch: any) => void) => {
            const handler = (_: unknown, batch: any) => cb(batch)
            ipcRenderer.on('youtube:channel-video-batch', handler)
            return () => {
                ipcRenderer.off('youtube:channel-video-batch', handler)
            }
        },
    },
})

// Durable state that survives a force quit. localStorage is written lazily by
// Chromium, so a killed process loses the most recent changes; the main process
// mirrors this to a JSON file in userData instead.
contextBridge.exposeInMainWorld('store', {
    // Synchronous on purpose: the download table seeds its very first render
    // from this, so an async read would mount an empty table and flash in.
    getSync: (key: string) => ipcRenderer.sendSync('store:get-sync', key),
    set: (key: string, value: unknown) =>
        ipcRenderer.invoke('store:set', key, value) as Promise<void>,
    flush: () => ipcRenderer.invoke('store:flush') as Promise<void>,
})

contextBridge.exposeInMainWorld('windowControls', {
    platform: process.platform,
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () =>
        ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
    moveBy: (dx: number, dy: number) =>
        ipcRenderer.invoke('window:move-by', dx, dy),
    onMaximizedChange: (cb: (maximized: boolean) => void) => {
        const handler = (_: unknown, maximized: boolean) => cb(maximized)
        ipcRenderer.on('window:maximized-changed', handler)
        return () => {
            ipcRenderer.off('window:maximized-changed', handler)
        }
    },
})
