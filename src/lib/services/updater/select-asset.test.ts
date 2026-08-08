import type { ReleaseAsset } from './types'

import { describe, expect, it } from 'vitest'

import { compareVersions, pickAsset, pickBestAsset } from './select-asset'

function asset(name: string): ReleaseAsset {
    return {
        name,
        browser_download_url: `https://example.com/${name}`,
        size: 1024,
    }
}

const WINDOWS_ASSETS = [
    asset('FuseGrab-Setup-1.2.0-arm64.exe'),
    asset('FuseGrab-Setup-1.2.0-x64.exe'),
    asset('FuseGrab-Setup-1.2.0-x64.zip'),
]

const MAC_ASSETS = [
    asset('FuseGrab-1.2.0-arm64.dmg'),
    asset('FuseGrab-1.2.0-x64.dmg'),
]

describe('pickAsset', () => {
    it('picks the x64 Windows installer on x64 Windows', () => {
        const match = pickAsset(WINDOWS_ASSETS, 'win32', 'x64')

        expect(match?.asset.name).toBe('FuseGrab-Setup-1.2.0-x64.exe')
        expect(match?.kind).toBe('windows-installer')
    })

    it('picks the arm64 Windows installer on ARM Windows', () => {
        const match = pickAsset(WINDOWS_ASSETS, 'win32', 'arm64')

        expect(match?.asset.name).toBe('FuseGrab-Setup-1.2.0-arm64.exe')
        expect(match?.kind).toBe('windows-installer')
    })

    it('picks the arm64 DMG on Apple Silicon', () => {
        const match = pickAsset(MAC_ASSETS, 'darwin', 'arm64')

        expect(match?.asset.name).toBe('FuseGrab-1.2.0-arm64.dmg')
        expect(match?.kind).toBe('mac-dmg')
    })

    it('picks the x64 DMG on Intel Macs, never the arm64 one', () => {
        const match = pickAsset(MAC_ASSETS, 'darwin', 'x64')

        expect(match?.asset.name).toBe('FuseGrab-1.2.0-x64.dmg')
        expect(match?.kind).toBe('mac-dmg')
    })

    it('ignores non-installer extensions (e.g. zips)', () => {
        expect(
            pickAsset([asset('FuseGrab-1.2.0-x64.zip')], 'win32', 'x64'),
        ).toBeNull()
    })

    it('returns null on unsupported platforms', () => {
        expect(pickAsset(WINDOWS_ASSETS, 'linux', 'x64')).toBeNull()
    })
})

describe('pickBestAsset fallbacks', () => {
    it('prefers the running arch, then x64, then the first candidate', () => {
        const assets = [
            asset('FuseGrab-1.2.0-universal.dmg'),
            asset('FuseGrab-1.2.0-x64.dmg'),
        ]

        expect(
            pickBestAsset(assets, '.dmg', 'arm64')?.name,
        ).toBe('FuseGrab-1.2.0-x64.dmg')
        expect(
            pickBestAsset([asset('FuseGrab-1.2.0-universal.dmg')], '.dmg', 'arm64')
                ?.name,
        ).toBe('FuseGrab-1.2.0-universal.dmg')
    })
})

describe('compareVersions', () => {
    it('treats v-prefixed tags and bare versions as equal', () => {
        expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    })

    it('orders newer versions above older ones', () => {
        expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0)
        expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
    })

    it('compares prerelease tags on the base version', () => {
        expect(compareVersions('1.0.1-beta', '1.0.1')).toBe(0)
    })

    it('handles partial version strings', () => {
        expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0)
    })
})
