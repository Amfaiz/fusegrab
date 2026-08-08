import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { toFriendlyError } from './lib/network-error'
import {
    chooseDirectory,
    chooseSavePath,
    closeAllWriteStreams,
    closeWriteStream,
    deletePartialFile,
    getDefaultDownloadDir,
    openWriteStream,
    revealInFolder,
    saveTextFile,
    writeStreamChunk,
} from './lib/services/files/service'
import {
    initSessionLogger,
    shutdownLogger,
} from './lib/services/logger/service'
import {
    flushStoreSync,
    getStoreValue,
    setStoreValue,
} from './lib/services/store/service'
import {
    checkForUpdate,
    cleanupStaleInstallers,
    downloadUpdate,
    getUpdateState,
    quitAndInstall,
    setUpdaterWindow,
} from './lib/services/updater/service'
import {
    cancelYoutubeDownload,
    destroyScraperWindows,
    downloadYoutubeChannel,
    downloadYoutubeVideo,
    getActiveDownloadState,
    getYoutubeChannelPage,
    getYoutubeUrlType,
    getYoutubeVideoInfo,
} from './lib/services/youtube/service'

// electron-squirrel-startup is CommonJS. Importing it with a normal ESM `import`
// makes Node run its CJS-interop preparse at link time, which crashes the whole
// main bundle in the packaged build before any code runs. createRequire loads it
// through the CJS loader instead, which is safe. (electron itself is fine as an
// ESM import — Electron provides it natively.)
const squirrelStartup = createRequire(import.meta.url)(
    'electron-squirrel-startup',
) as boolean

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (squirrelStartup) {
    app.quit()
}

// Declare the globals injected by the Electron Forge Vite plugin
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string
declare const MAIN_WINDOW_VITE_NAME: string

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isMac = process.platform === 'darwin'

// In development the Vite dev server occasionally returns a truncated response
// (e.g. when a dependency re-optimization interrupts an in-flight request).
// Source modules are served `Cache-Control: no-cache`, which means *store and
// revalidate* — so Electron keeps the truncated body and, on the next 304,
// reuses it. The corrupted chunk then sticks across reloads and even restarts,
// surfacing as "Unexpected end of input" / "Unexpected identifier 'is'" with a
// blank window. Disabling the HTTP cache in dev makes every module load fresh
// and sidesteps the whole class of problem. (No effect on packaged builds.)
if (!app.isPackaged) {
    app.commandLine.appendSwitch('disable-http-cache')
}

// Runtime window/taskbar icon. macOS uses the app bundle's .icns, so this is
// only needed on Windows/Linux. In packaged builds the rounded PNG is shipped
// via extraResource; in dev it lives under assets/.
const windowIcon = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.rounded.png')
    : path.join(__dirname, '../../assets/icon.rounded.png')

// A second launch should surface the window we already have rather than start a
// rival process — two instances would race each other writing the state file.
// `app.quit()` is not immediate, so `ready` can still fire on the losing
// instance; the flag stops it from building a window on its way out.
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) {
    app.quit()
}

// Only real UI windows. The channel scraper runs in offscreen windows that also
// show up in `BrowserWindow.getAllWindows()`, and counting those would make the
// app look like it still has a window open when it does not, so the windows we
// create for the UI are tracked explicitly.
const appWindows = new Set<BrowserWindow>()

const getVisibleWindows = () =>
    Array.from(appWindows).filter((win) => !win.isDestroyed())

// Closing the UI ends the session, so tear down everything that could outlive
// it. Without this the hidden channel-scraper window (and its long-running
// scroll loop) keeps the process alive: `window-all-closed` never fires, the app
// lingers until a right-click → Quit, and an in-flight download keeps
// `activeDownloadState.isDownloading` set. Relaunching on macOS reuses that same
// process, so the fresh renderer reads the stale "still downloading" state and
// refuses to start anything — leaving every item stuck at Queued.
function shutdownSession() {
    cancelYoutubeDownload()
    destroyScraperWindows()
}

const createWindow = () => {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        minWidth: 1024,
        minHeight: 768,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // Fully disable DevTools in packaged builds. This blocks
            // openDevTools(), the menu accelerator, and the built-in
            // F12 / Ctrl+Shift+I / Cmd+Opt+I shortcuts. Kept on in dev.
            devTools: !app.isPackaged,
        },
        // Modern premium aesthetics
        autoHideMenuBar: true,
        ...(isMac ? {} : { icon: windowIcon }),
        ...(isMac
            ? ({
                  titleBarStyle: 'hidden',
                  trafficLightPosition: { x: 13, y: 14 },
                  backgroundColor: '#ffffff',
              } as const)
            : ({
                  frame: false,
                  backgroundColor: '#ffffff',
              } as const)),
    })

    appWindows.add(mainWindow)

    // The UI window going away ends the session. Tear down the offscreen
    // scraper windows and any running download here rather than waiting for
    // `window-all-closed` — that event cannot fire while a scraper window is
    // still open, which is exactly what used to keep the app in the dock.
    mainWindow.on('closed', () => {
        appWindows.delete(mainWindow)
        if (getVisibleWindows().length === 0) {
            shutdownSession()
        }
    })

    setUpdaterWindow(mainWindow)

    // The custom titlebar mirrors the maximized state (restore vs maximize icon,
    // and the root `data-maximized` flag), so push every change to the renderer.
    const emitMaximized = (maximized: boolean) => {
        if (mainWindow.isDestroyed()) return
        mainWindow.webContents.send('window:maximized-changed', maximized)
    }
    mainWindow.on('maximize', () => emitMaximized(true))
    mainWindow.on('unmaximize', () => emitMaximized(false))

    // Intercept standard target="_blank" links and open in host OS default web browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url).catch((err) => {
            console.error('Failed to open external link:', err)
        })
        return { action: 'deny' }
    })

    if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined') {
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    } else {
        mainWindow.loadFile(
            path.join(
                __dirname,
                `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
            ),
        )
    }

    // Open the DevTools in development
    if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined') {
        mainWindow.webContents.openDevTools()
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', async () => {
    // Lost the single-instance lock: this process is already quitting, so don't
    // start a session that would write logs and state over the real instance's.
    if (!isPrimaryInstance) return

    // Initialize session logger
    const logger = initSessionLogger(path.join(app.getPath('userData'), 'logs'))
    logger.startSession('FuseGrab Application', {
        platform: process.platform,
        arch: process.arch,
        version: app.getVersion(),
    })

    // Clear any installer left in temp by a previous (now-applied) update.
    await cleanupStaleInstallers()

    createWindow()

    // Check for updates a few seconds after launch so it doesn't compete with
    // startup work. The renderer can also trigger a manual re-check.
    setTimeout(() => {
        checkForUpdate().catch((err) => {
            console.error('Update check failed:', err)
        })
    }, 4000)
})

// A cancelled or crashed export can leave a file handle open; make sure they're
// all closed (and their partial files removed) before the process goes away.
// shutdownLogger() and flushStoreSync() are deliberately synchronous: Electron
// does not await before-quit listeners, so async work can be cut off by exit.
app.on('before-quit', () => {
    void closeAllWriteStreams()
    flushStoreSync()
    shutdownLogger()
})

// Quit when all windows are closed — including on macOS. The usual mac
// convention keeps the app alive in the dock after the last window closes, but
// FuseGrab is a single-window utility with nothing useful to do windowless, so
// the red traffic-light button should fully quit instead of requiring an extra
// right-click → Quit on the dock icon.
app.on('window-all-closed', () => {
    shutdownSession()
    app.quit()
})

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open. A hidden
    // scraper window must not count as "a window is already open", or the
    // dock icon would bring back an app with no visible UI.
    if (getVisibleWindows().length === 0) {
        createWindow()
    }
})

// Someone launched FuseGrab again while it was already running: focus the
// window we have instead of starting a second copy.
app.on('second-instance', () => {
    const [existing] = getVisibleWindows()
    if (existing) {
        if (existing.isMinimized()) existing.restore()
        existing.focus()
    } else {
        createWindow()
    }
})

// Wraps ipcMain.handle so every handler's rejection is normalized before it
// crosses IPC. Network failures (no internet, DNS, refused sockets) collapse
// into one clear "no internet" message instead of surfacing internal channel
// names or "AggregateError" to the renderer.
function handle(
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
) {
    ipcMain.handle(channel, async (event, ...args) => {
        try {
            return await listener(event, ...args)
        } catch (err) {
            throw toFriendlyError(err)
        }
    })
}

handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
})
handle('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) {
        win.unmaximize()
    } else {
        win.maximize()
    }
})
handle('window:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isMaximized() ?? false
})
handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
})
handle('window:move-by', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isMaximized()) return
    const [x, y] = win.getPosition()
    win.setPosition(x + Math.round(dx), y + Math.round(dy))
})

handle('files:choose-save-path', (event, target) =>
    chooseSavePath(BrowserWindow.fromWebContents(event.sender), target),
)
handle('files:choose-directory', (event, defaultPath?: string) =>
    chooseDirectory(BrowserWindow.fromWebContents(event.sender), defaultPath),
)
handle('files:get-default-dir', () => getDefaultDownloadDir())
handle('files:save-text', (event, target, contents: string) =>
    saveTextFile(BrowserWindow.fromWebContents(event.sender), target, contents),
)
handle('files:open-write', (_event, filePath: string) =>
    openWriteStream(filePath),
)
handle(
    'files:write',
    (_event, id: number, position: number, data: Uint8Array) =>
        writeStreamChunk(id, position, data),
)
handle('files:close-write', (_event, id: number, discard: boolean) =>
    closeWriteStream(id, discard),
)
handle('files:reveal', (_event, filePath: string) => revealInFolder(filePath))
handle('files:delete-partial', (_event, filePath: string) =>
    deletePartialFile(filePath),
)

handle('updater:get-state', () => getUpdateState())
handle('updater:check', () => checkForUpdate())
handle('updater:download', () => downloadUpdate())
handle('updater:install', () => quitAndInstall())
handle('app:get-version', () => app.getVersion())

handle('youtube:get-info', (_event, url: string) => getYoutubeVideoInfo(url))
handle('youtube:get-url-type', (_event, url: string) => getYoutubeUrlType(url))
handle(
    'youtube:get-channel-page',
    (event, url: string, page?: number, limit?: number) =>
        getYoutubeChannelPage(
            BrowserWindow.fromWebContents(event.sender),
            url,
            page,
            limit,
        ),
)
handle('youtube:download', (event, options) =>
    downloadYoutubeVideo(BrowserWindow.fromWebContents(event.sender), options),
)
handle('youtube:download-channel', (event, options) =>
    downloadYoutubeChannel(
        BrowserWindow.fromWebContents(event.sender),
        options,
    ),
)
handle('youtube:cancel-download', () => cancelYoutubeDownload())

// Renderer state that must outlive a force quit. localStorage alone loses the
// last writes when the process is killed, so the table is mirrored here.
ipcMain.on('store:get-sync', (event, key: string) => {
    // Synchronous so the renderer can seed its first render from disk. Without
    // it the table would mount empty and then flash in.
    event.returnValue = getStoreValue(key)
})
handle('store:set', (_event, key: string, value: unknown) => {
    setStoreValue(key, value)
})
handle('store:flush', () => flushStoreSync())
handle('youtube:get-download-state', () => getActiveDownloadState())
