import type { BrowserWindow } from 'electron'
import type { FileHandle } from 'node:fs/promises'

import { app, dialog, shell } from 'electron'
import { existsSync } from 'node:fs'
import { open, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type SaveTarget = {
    /** Suggested file name, extension included. */
    defaultName: string
    /** Folder to open the dialog in. Falls back to the user's Movies/Videos folder. */
    defaultDir?: string | null
    filters?: Array<{ name: string; extensions: Array<string> }>
}

function defaultPathFor(target: SaveTarget): string {
    const dir = target.defaultDir?.trim() || app.getPath('videos')
    return path.join(dir, target.defaultName)
}

async function showSaveDialog(
    win: BrowserWindow | null,
    target: SaveTarget,
): Promise<string | null> {
    const options: Electron.SaveDialogOptions = {
        defaultPath: defaultPathFor(target),
        filters: target.filters,
    }
    const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    return result.filePath
}

export async function chooseSavePath(
    win: BrowserWindow | null,
    target: SaveTarget,
): Promise<string | null> {
    return showSaveDialog(win, target)
}

export async function chooseDirectory(
    win: BrowserWindow | null,
    defaultPath?: string,
): Promise<string | null> {
    const options: Electron.OpenDialogOptions = {
        defaultPath: defaultPath?.trim() || app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory'],
    }
    const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths || result.filePaths.length === 0)
        return null
    return result.filePaths[0]
}

export function getDefaultDownloadDir(): string {
    return app.getPath('downloads')
}

/** Prompts for a location and writes `contents` there. Returns the path, or null if cancelled. */
export async function saveTextFile(
    win: BrowserWindow | null,
    target: SaveTarget,
    contents: string,
): Promise<string | null> {
    const filePath = await showSaveDialog(win, target)
    if (!filePath) return null
    await writeFile(filePath, contents, 'utf8')
    return filePath
}

// Streamed, seekable writes. The burn-in export muxes an MP4 in the renderer
// and hands us 16 MiB chunks as it goes, each with the absolute offset it
// belongs at — MP4 finalization patches box sizes near the start of the file
// once the media data is known, so writes are positional rather than
// append-only. Keeping an open handle here means a multi-gigabyte export never
// has to exist in memory.
type WriteStream = {
    handle: FileHandle
    filePath: string
    /** Highest offset written so far, i.e. the file size. */
    size: number
}

const streams = new Map<number, WriteStream>()
let nextStreamId = 1

export async function openWriteStream(filePath: string): Promise<number> {
    const handle = await open(filePath, 'w+')
    const id = nextStreamId++
    streams.set(id, { handle, filePath, size: 0 })
    return id
}

export async function writeStreamChunk(
    id: number,
    position: number,
    data: Uint8Array,
): Promise<void> {
    const stream = streams.get(id)
    if (!stream) throw new Error('The export file is no longer open.')
    await stream.handle.write(data, 0, data.byteLength, position)
    stream.size = Math.max(stream.size, position + data.byteLength)
}

/**
 * Closes the handle. When `discard` is set (a cancelled or failed export) the
 * partial file is deleted too, so a half-muxed MP4 is never left behind.
 */
export async function closeWriteStream(
    id: number,
    discard = false,
): Promise<{ filePath: string; size: number } | null> {
    const stream = streams.get(id)
    if (!stream) return null
    streams.delete(id)
    await stream.handle.close().catch(() => undefined)
    if (discard) {
        await rm(stream.filePath, { force: true }).catch(() => undefined)
        return null
    }
    return { filePath: stream.filePath, size: stream.size }
}

/** Closes every open handle. Called on quit so nothing is left dangling. */
export async function closeAllWriteStreams(): Promise<void> {
    const open = [...streams.keys()]
    await Promise.all(open.map((id) => closeWriteStream(id, true)))
}

export function revealInFolder(filePath: string): boolean {
    if (!existsSync(filePath)) {
        return false
    }
    shell.showItemInFolder(filePath)
    return true
}

export async function deletePartialFile(filePath: string): Promise<void> {
    if (!filePath) return
    const candidates = [
        filePath,
        filePath + '.part',
        filePath + '.ytdl',
        filePath.replace(/\.[^/.]+$/, '.part'),
    ]
    for (const c of candidates) {
        if (existsSync(c)) {
            await rm(c, { force: true }).catch(() => undefined)
        }
    }
}
