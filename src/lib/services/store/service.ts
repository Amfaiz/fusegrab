import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Durable key/value store for renderer state that must survive a hard quit.
 *
 * localStorage is not enough on its own: Chromium flushes it to disk lazily, so
 * a force quit (or the OS killing the process) drops the most recent writes and
 * the download table comes back empty. This writes into userData atomically and
 * can be flushed synchronously from `before-quit`.
 */
type StoreData = Record<string, unknown>

const SAVE_DEBOUNCE_MS = 250

let cache: StoreData | null = null
let saveTimer: NodeJS.Timeout | null = null
let dirty = false

function storePath(): string {
    return path.join(app.getPath('userData'), 'fusegrab-state.json')
}

function load(): StoreData {
    if (cache) return cache
    try {
        const parsed: unknown = JSON.parse(readFileSync(storePath(), 'utf8'))
        cache =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? (parsed as StoreData)
                : {}
    } catch {
        // Missing or corrupt state file: start clean rather than failing boot.
        cache = {}
    }
    return cache
}

// Write to a sibling temp file, then rename. rename(2) is atomic within a
// filesystem, so being killed mid-write can never leave a truncated state file
// behind — the reader either sees the old file or the complete new one.
function persist(): void {
    if (!cache) return
    const target = storePath()
    const tmp = `${target}.tmp`
    try {
        writeFileSync(tmp, JSON.stringify(cache), 'utf8')
        renameSync(tmp, target)
        dirty = false
    } catch (err) {
        console.error('Failed to persist app state:', err)
    }
}

export function getStoreValue(key: string): unknown {
    return load()[key] ?? null
}

export function setStoreValue(key: string, value: unknown): void {
    load()[key] = value
    dirty = true
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
        saveTimer = null
        persist()
    }, SAVE_DEBOUNCE_MS)
}

/**
 * Flush a pending debounced write immediately. Deliberately synchronous:
 * Electron does not await `before-quit` listeners, so an async write here can
 * be cut off by process exit.
 */
export function flushStoreSync(): void {
    if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
    }
    if (dirty) persist()
}
