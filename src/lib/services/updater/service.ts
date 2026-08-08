import type {
    Release,
    ReleaseAsset,
    UpdateAssetKind,
    UpdateState,
} from './types'
import type { BrowserWindow } from 'electron'

import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { toFriendlyError } from '#/lib/network-error'

import { clampPercent, installMacDmg, updatesDir } from './mac-installer'
import { compareVersions, pickAsset } from './select-asset'

export type { UpdateAssetKind, UpdateState, UpdateStatus } from './types'

// The *releases* repo, separate from this private source repo. It must be
// public — the check below calls the GitHub API unauthenticated, and a private
// repo 404s as if it didn't exist.
const OWNER = 'Amfaiz'
const REPO = 'fusegrab'
const LATEST_RELEASE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`

let state: UpdateState = {
    status: 'idle',
    version: null,
    notes: null,
    percent: 0,
    transferred: 0,
    total: 0,
    assetKind: null,
    error: null,
}

let selectedAsset: ReleaseAsset | null = null
let selectedAssetKind: UpdateAssetKind | null = null
let downloadedInstaller: string | null = null
let installing = false
let mainWindow: BrowserWindow | null = null

function setProgress(percent: number) {
    setState({ percent: clampPercent(percent) })
}

export function setUpdaterWindow(win: BrowserWindow) {
    mainWindow = win
}

export function getUpdateState(): UpdateState {
    return state
}

function setState(patch: Partial<UpdateState>) {
    state = { ...state, ...patch }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:state', state)
    }
}

function installerAssetDescription(): string {
    if (process.platform === 'win32') return 'Windows installer'
    if (process.platform === 'darwin') return 'macOS DMG'
    return `${process.platform} installer`
}

function clearSelectedAsset() {
    selectedAsset = null
    selectedAssetKind = null
    downloadedInstaller = null
}

export async function cleanupStaleInstallers(): Promise<void> {
    try {
        const dir = updatesDir()
        await rm(dir, { recursive: true, force: true })
    } catch {}
}

export async function checkForUpdate(): Promise<UpdateState> {
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
        clearSelectedAsset()
        setState({ status: 'idle', assetKind: null })
        return state
    }
    try {
        setState({ status: 'checking', error: null })
        const res = await fetch(LATEST_RELEASE_URL, {
            headers: {
                'User-Agent': 'FuseGrab-Updater',
                Accept: 'application/vnd.github+json',
            },
        })
        if (res.status === 404) {
            clearSelectedAsset()
            setState({
                status: 'idle',
                version: null,
                notes: null,
                assetKind: null,
            })
            return state
        }
        if (!res.ok) {
            // 403 with no quota headers is GitHub rate-limiting unauthenticated
            // requests; the repo being private or gone also 403s (and 404s are
            // handled above as "no update available").
            if (res.status === 403 && !res.headers.has('x-ratelimit-remaining')) {
                throw new Error(
                    'Update service is busy right now. Try again in a few minutes.',
                )
            }
            throw new Error(
                `Update service is unavailable right now (HTTP ${res.status}). Try again later.`,
            )
        }
        const release = (await res.json()) as Release
        const latest = release.tag_name
        const current = app.getVersion()

        if (compareVersions(latest, current) <= 0) {
            clearSelectedAsset()
            setState({
                status: 'idle',
                version: null,
                notes: null,
                assetKind: null,
            })
            return state
        }

        const stripped = latest.replace(/^v/i, '')
        if (
            state.version === stripped &&
            (state.status === 'downloading' || state.status === 'downloaded')
        ) {
            return state
        }

        const match = pickAsset(
            release.assets,
            process.platform,
            process.arch,
        )
        if (!match) {
            clearSelectedAsset()
            setState({
                status: 'idle',
                version: null,
                notes: null,
                assetKind: null,
            })
            return state
        }

        selectedAsset = match.asset
        selectedAssetKind = match.kind
        downloadedInstaller = null

        setState({
            status: 'available',
            version: stripped,
            notes: release.body,
            percent: 0,
            transferred: 0,
            total: match.asset.size,
            assetKind: match.kind,
            error: null,
        })
        return state
    } catch (err: any) {
        clearSelectedAsset()
        setState({
            status: 'error',
            error: toFriendlyError(err).message,
        })
        return state
    }
}

export async function downloadUpdate(): Promise<void> {
    if (!selectedAsset || !selectedAssetKind) {
        throw new Error('No update asset is available to download.')
    }
    if (state.status === 'downloading' || state.status === 'downloaded') {
        return
    }

    try {
        setState({
            status: 'downloading',
            percent: 0,
            transferred: 0,
            error: null,
        })

        const dir = updatesDir()
        await mkdir(dir, { recursive: true })
        const targetPath = path.join(dir, selectedAsset.name)
        await rm(targetPath, { force: true })

        const res = await fetch(selectedAsset.browser_download_url, {
            headers: {
                'User-Agent': 'FuseGrab-Updater',
                Accept: 'application/octet-stream',
            },
        })
        if (!res.ok || !res.body) {
            throw new Error(
                `Failed to download installer (${res.status} ${res.statusText})`,
            )
        }

        const contentLengthHeader = res.headers.get('content-length')
        const total = contentLengthHeader
            ? parseInt(contentLengthHeader, 10)
            : selectedAsset.size
        setState({ total })

        const fileStream = createWriteStream(targetPath)
        const reader = res.body.getReader()
        let transferred = 0

        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                if (value) {
                    fileStream.write(Buffer.from(value))
                    transferred += value.byteLength
                    const percent = total > 0 ? (transferred / total) * 100 : 0
                    setState({
                        transferred,
                        percent: clampPercent(percent),
                    })
                }
            }
        } finally {
            fileStream.end()
            await new Promise<void>((resolve) => {
                fileStream.on('finish', () => resolve())
            })
        }

        if (selectedAssetKind === 'windows-installer') {
            await chmod(targetPath, 0o755)
        }

        downloadedInstaller = targetPath
        setState({
            status: 'downloaded',
            percent: 100,
            transferred: total,
        })
    } catch (err: any) {
        setState({
            status: 'error',
            error: toFriendlyError(err).message,
        })
    }
}

async function findInstallerInDirectory(
    dir: string,
    extension: string,
): Promise<string | null> {
    try {
        const entries = await readdir(dir, { withFileTypes: true })
        const file = entries.find(
            (e) => e.isFile() && e.name.toLowerCase().endsWith(extension),
        )
        return file ? path.join(dir, file.name) : null
    } catch {
        return null
    }
}

export async function installUpdate(): Promise<boolean> {
    if (installing) return false
    installing = true

    try {
        if (!downloadedInstaller || selectedAssetKind !== state.assetKind) {
            const dir = updatesDir()
            const extension = process.platform === 'win32' ? '.exe' : '.dmg'
            const candidate = await findInstallerInDirectory(dir, extension)
            if (candidate) {
                downloadedInstaller = candidate
            }
        }

        if (!downloadedInstaller) {
            throw new Error(
                `The downloaded ${installerAssetDescription()} is missing. Try checking for updates again.`,
            )
        }

        setState({ status: 'installing', error: null })

        if (process.platform === 'win32') {
            // /AUTOUPDATE matches the convention in build/installer.nsi: the
            // installer shows its progress window but skips every choice page
            // and relaunches the app itself when done.
            const child = spawn(downloadedInstaller, ['/AUTOUPDATE'], {
                detached: true,
                stdio: 'ignore',
            })
            child.unref()
            app.quit()
            return true
        }

        if (process.platform === 'darwin') {
            return await installMacDmg(downloadedInstaller, setProgress)
        }

        throw new Error(
            `Automated updates are not supported on ${process.platform}.`,
        )
    } catch (err: any) {
        setState({
            status: 'error',
            error: err.message || 'Failed to start installation.',
        })
        return false
    } finally {
        installing = false
    }
}

export async function quitAndInstall(): Promise<boolean> {
    return installUpdate()
}
