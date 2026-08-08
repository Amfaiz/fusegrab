import type { ReleaseAsset, UpdateAssetKind } from './types'

/**
 * Release asset matching is deliberately arch-tagged by filename
 * (`FuseGrab-Setup-1.0.0-x64.exe`, `FuseGrab-1.0.0-arm64.dmg`), so the running
 * build can be paired with its own installer. Kept free of electron/process
 * imports so it can be unit-tested directly.
 */

function parseVersion(v: string): number[] {
    return v
        .replace(/^v/i, '')
        .split('-')[0]
        .split('.')
        .map((n) => parseInt(n, 10) || 0)
}

export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a)
    const pb = parseVersion(b)
    const len = Math.max(pa.length, pb.length)
    for (let i = 0; i < len; i++) {
        const da = pa[i] ?? 0
        const db = pb[i] ?? 0
        if (da !== db) return da - db
    }
    return 0
}

export function pickBestAsset(
    assets: ReleaseAsset[],
    extension: string,
    arch: string,
): ReleaseAsset | null {
    const candidates = assets.filter((a) =>
        a.name.toLowerCase().endsWith(extension),
    )
    if (candidates.length === 0) return null
    return (
        candidates.find((a) => a.name.toLowerCase().includes(arch)) ??
        candidates.find((a) => a.name.toLowerCase().includes('x64')) ??
        candidates[0]
    )
}

export function pickAsset(
    assets: ReleaseAsset[],
    platform: string,
    arch: string,
): { asset: ReleaseAsset; kind: UpdateAssetKind } | null {
    if (platform === 'win32') {
        const asset = pickBestAsset(assets, '.exe', arch)
        return asset ? { asset, kind: 'windows-installer' } : null
    }
    if (platform === 'darwin') {
        const asset = pickBestAsset(assets, '.dmg', arch)
        return asset ? { asset, kind: 'mac-dmg' } : null
    }
    return null
}
