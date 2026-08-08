import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string

// The store resolves its file through app.getPath('userData'); point that at a
// temp dir so the tests never touch the real profile.
vi.mock('electron', () => ({
    app: { getPath: () => userDataDir },
}))

describe('durable state store', () => {
    let statePath: string

    beforeEach(async () => {
        userDataDir = path.join(
            os.tmpdir(),
            `fusegrab_test_store_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        )
        statePath = path.join(userDataDir, 'fusegrab-state.json')
        await mkdir(userDataDir, { recursive: true })
        vi.resetModules()
    })

    afterEach(async () => {
        await rm(userDataDir, { recursive: true, force: true }).catch(
            () => undefined,
        )
    })

    it('flushes a pending write synchronously, as before-quit requires', async () => {
        const { setStoreValue, flushStoreSync } = await import('./service')

        setStoreValue('items', [{ id: 'a', status: 'Ready' }])
        // Still only in the debounce window: nothing on disk yet.
        expect(() => readFileSync(statePath, 'utf8')).toThrow()

        flushStoreSync()

        expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
            items: [{ id: 'a', status: 'Ready' }],
        })
    })

    it('reads back state written by a previous run', async () => {
        writeFileSync(statePath, JSON.stringify({ items: [{ id: 'kept' }] }))

        const { getStoreValue } = await import('./service')

        expect(getStoreValue('items')).toEqual([{ id: 'kept' }])
    })

    it('returns null for keys that were never written', async () => {
        const { getStoreValue } = await import('./service')

        expect(getStoreValue('items')).toBeNull()
    })

    it('starts clean instead of throwing when the state file is corrupt', async () => {
        writeFileSync(statePath, '{ this is not json')

        const { getStoreValue, setStoreValue, flushStoreSync } =
            await import('./service')

        expect(getStoreValue('items')).toBeNull()

        // A corrupt file must not wedge later writes.
        setStoreValue('items', ['recovered'])
        flushStoreSync()
        expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
            items: ['recovered'],
        })
    })

    it('leaves no temp file behind, so writes stay atomic', async () => {
        const { setStoreValue, flushStoreSync } = await import('./service')

        setStoreValue('items', [1, 2, 3])
        flushStoreSync()

        expect(() => readFileSync(`${statePath}.tmp`, 'utf8')).toThrow()
    })

    it('keeps the last value when a key is written repeatedly', async () => {
        const { setStoreValue, flushStoreSync, getStoreValue } =
            await import('./service')

        setStoreValue('items', ['first'])
        setStoreValue('items', ['second'])
        setStoreValue('items', ['third'])
        flushStoreSync()

        expect(getStoreValue('items')).toEqual(['third'])
        expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
            items: ['third'],
        })
    })
})
