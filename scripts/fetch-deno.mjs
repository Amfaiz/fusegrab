// Downloads a static deno binary for a given target platform/arch and caches
// it under build/deno-cache/<platform>-<arch>/.
//
// Why this exists: yt-dlp needs a JavaScript runtime to solve YouTube's player
// challenges. Resolving deno at runtime works, but it stalls the user's first
// download on a ~40MB fetch. Unlike yt-dlp — which must stay fresh because it
// tracks YouTube's every change — deno is a stable, versioned runtime that does
// not change when YouTube changes, so pinning it in the installer has no
// staleness risk.
//
// Invoked automatically by forge.config.ts's afterCopy hook. Can also be run
// directly:  node scripts/fetch-deno.mjs win32 arm64

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const CACHE_ROOT = path.join(root, 'build', 'deno-cache')

export function getDenoAsset(platform, arch) {
    if (platform === 'win32') {
        if (arch === 'x64' || arch === 'ia32') {
            return 'deno-x86_64-pc-windows-msvc.zip'
        }
        if (arch === 'arm64') return 'deno-aarch64-pc-windows-msvc.zip'
        return null
    }
    if (platform === 'darwin') {
        return arch === 'arm64'
            ? 'deno-aarch64-apple-darwin.zip'
            : 'deno-x86_64-apple-darwin.zip'
    }
    if (platform === 'linux') {
        if (arch === 'x64') return 'deno-x86_64-unknown-linux-gnu.zip'
        if (arch === 'arm64') return 'deno-aarch64-unknown-linux-gnu.zip'
        return null
    }
    return null
}

export function getDenoBinaryName(platform) {
    return platform === 'win32' ? 'deno.exe' : 'deno'
}

async function extractFromZip(archivePath, platform) {
    const scratch = `${archivePath}-extract`
    await rm(scratch, { recursive: true, force: true })
    mkdirSync(scratch, { recursive: true })

    try {
        if (process.platform === 'win32') {
            // Windows 10+ ships bsdtar, which reads zips and is far faster
            // than PowerShell's Expand-Archive. Fall back if absent.
            try {
                execFileSync('tar', ['-xf', archivePath, '-C', scratch], {
                    stdio: 'ignore',
                    windowsHide: true,
                })
            } catch {
                execFileSync(
                    'powershell',
                    [
                        '-NoProfile',
                        '-NonInteractive',
                        '-Command',
                        `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${scratch}" -Force`,
                    ],
                    { stdio: 'ignore', windowsHide: true },
                )
            }
        } else {
            execFileSync('unzip', ['-q', '-o', archivePath, '-d', scratch], {
                stdio: 'ignore',
            })
        }

        const wanted = getDenoBinaryName(platform)
        const find = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) {
                    const hit = find(full)
                    if (hit) return hit
                } else if (entry.name.toLowerCase() === wanted) {
                    return full
                }
            }
            return null
        }

        const found = find(scratch)
        if (!found) {
            throw new Error(`${wanted} not found inside ${archivePath}`)
        }
        return await readFile(found)
    } finally {
        await rm(scratch, { recursive: true, force: true })
    }
}

/**
 * Resolves deno for the target into the cache and returns its path. Cached
 * results are reused so repeated `forge make` runs don't refetch.
 */
export async function fetchDeno(platform, arch, log = console.log) {
    const binName = getDenoBinaryName(platform)
    const cacheDir = path.join(CACHE_ROOT, `${platform}-${arch}`)
    const cached = path.join(cacheDir, binName)

    if (existsSync(cached)) {
        log(`deno (${platform}-${arch}): using cached ${cached}`)
        return cached
    }

    const asset = getDenoAsset(platform, arch)
    if (!asset) {
        throw new Error(`No deno asset known for ${platform}-${arch}`)
    }

    mkdirSync(cacheDir, { recursive: true })
    const url = `https://github.com/denoland/deno/releases/latest/download/${asset}`
    log(`deno (${platform}-${arch}): downloading ${url}`)

    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    const downloaded = Buffer.from(await res.arrayBuffer())
    if (downloaded.length < 1_000_000) {
        throw new Error(
            `Downloaded deno archive is implausibly small (${downloaded.length} bytes)`,
        )
    }

    const archivePath = path.join(cacheDir, 'deno-archive.zip')
    await writeFile(archivePath, downloaded)
    let binary
    try {
        binary = await extractFromZip(archivePath, platform)
    } finally {
        await rm(archivePath, { force: true })
    }

    if (binary.length < 10_000_000) {
        throw new Error(
            `Extracted deno is implausibly small (${binary.length} bytes)`,
        )
    }

    // Write then rename so an interrupted run never leaves a partial binary
    // that a later run would treat as a valid cache hit.
    const tmp = `${cached}.download`
    await writeFile(tmp, binary)
    await chmod(tmp, 0o755).catch(() => undefined)
    renameSync(tmp, cached)

    log(
        `deno (${platform}-${arch}): cached ${cached} (${(binary.length / 1e6).toFixed(1)} MB)`,
    )
    return cached
}

// Direct invocation: node scripts/fetch-deno.mjs [platform] [arch]
if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    const platform = process.argv[2] || process.platform
    const arch = process.argv[3] || process.arch
    fetchDeno(platform, arch).catch((err) => {
        console.error(err.message)
        process.exit(1)
    })
}
