import { describe, expect, it, vi } from 'vitest'

import { getPlatformUserAgent, ytDlpVersionNeedsUpdate } from './binary'

describe('getPlatformUserAgent', () => {
    it('advertises the Chromium version the app actually ships', () => {
        const ua = getPlatformUserAgent()
        const shipped = process.versions.chrome || '130.0.0.0'
        expect(ua).toContain(`Chrome/${shipped}`)
        expect(ua).toContain('AppleWebKit/537.36')
    })

    it('matches the host platform', () => {
        const ua = getPlatformUserAgent()
        if (process.platform === 'darwin') {
            expect(ua).toContain('Macintosh')
        } else if (process.platform === 'win32') {
            expect(ua).toContain('Windows NT')
        } else {
            expect(ua).toContain('X11')
        }
    })
})

vi.mock('electron', () => ({
    app: { getPath: () => '/tmp/fusegrab-test' },
}))

describe('ytDlpVersionNeedsUpdate', () => {
    it('keeps the existing binary when GitHub is unreachable', () => {
        expect(ytDlpVersionNeedsUpdate('2026.08.10', null)).toBe(false)
        expect(ytDlpVersionNeedsUpdate(null, null)).toBe(false)
    })

    it('redownloads when the local binary cannot report a version', () => {
        expect(ytDlpVersionNeedsUpdate(null, '2026.08.11')).toBe(true)
    })

    it('is a no-op when versions match', () => {
        expect(ytDlpVersionNeedsUpdate('2026.08.11', '2026.08.11')).toBe(false)
    })

    it('flags any difference, including whitespace drift', () => {
        expect(ytDlpVersionNeedsUpdate('2026.08.10', '2026.08.11')).toBe(true)
        expect(ytDlpVersionNeedsUpdate(' 2026.08.11 ', '2026.08.11')).toBe(
            false,
        )
    })
})
