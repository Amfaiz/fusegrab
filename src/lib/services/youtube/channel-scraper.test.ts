import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
    BrowserWindow: class {},
    session: { fromPartition: () => ({ cookies: { set: async () => {} } }) },
}))

describe('destroyScraperWindows', () => {
    it('destroys every tracked window so window-all-closed can fire', async () => {
        const { destroyScraperWindows, __trackScraperWindow } =
            await import('./channel-scraper')

        const destroyed: Array<string> = []
        const makeWin = (name: string) => ({
            destroy: () => destroyed.push(name),
            on: () => {},
            isDestroyed: () => false,
        })

        __trackScraperWindow(makeWin('a') as never)
        __trackScraperWindow(makeWin('b') as never)

        destroyScraperWindows()

        expect(destroyed).toEqual(['a', 'b'])
    })

    it('keeps going when one window throws on destroy', async () => {
        const { destroyScraperWindows, __trackScraperWindow } =
            await import('./channel-scraper')

        const destroyed: Array<string> = []
        __trackScraperWindow({
            destroy: () => {
                throw new Error('already gone')
            },
            on: () => {},
        } as never)
        __trackScraperWindow({
            destroy: () => destroyed.push('survivor'),
            on: () => {},
        } as never)

        expect(() => destroyScraperWindows()).not.toThrow()
        expect(destroyed).toEqual(['survivor'])
    })

    it('is a no-op the second time, so a double shutdown is safe', async () => {
        const { destroyScraperWindows, __trackScraperWindow } =
            await import('./channel-scraper')

        let count = 0
        __trackScraperWindow({
            destroy: () => {
                count++
            },
            on: () => {},
        } as never)

        destroyScraperWindows()
        destroyScraperWindows()

        expect(count).toBe(1)
    })
})
