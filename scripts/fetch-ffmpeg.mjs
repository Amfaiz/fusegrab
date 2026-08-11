// Downloads a static ffmpeg binary for a given target platform/arch and caches
// it under build/ffmpeg-cache/<platform>-<arch>/.
//
// Why this exists: ffmpeg is required to mux yt-dlp's separate video and audio
// streams. Resolving it at runtime works, but it means the user's first
// download stalls on a ~40MB fetch, and it fails outright offline or behind a
// restrictive network. Bundling it into the installer removes that dependency.
//
// The npm `ffmpeg-static` package can't cover this on its own: its postinstall
// fetches only the *host* binary, and the upstream release has no win32-arm64
// asset at all. Cross-arch builds (see scripts/build-installers.mjs, which
// makes darwin arm64/x64 and win32 arm64/x64 from one machine) therefore need
// an explicit per-target fetch.
//
// Invoked automatically by forge.config.ts's afterCopy hook. Can also be run
// directly:  node scripts/fetch-ffmpeg.mjs win32 arm64

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const CACHE_ROOT = path.join(root, 'build', 'ffmpeg-cache')

const EUGENEWARE_RELEASE = 'b6.1.1'

// eugeneware/ffmpeg-static ships no Windows ARM64 asset, so ARM Windows pulls
// from BtbN/FFmpeg-Builds, the maintained source of static winarm64 builds.
const BTBN_WIN_ARM64_ASSET = 'ffmpeg-n7.1-latest-winarm64-lgpl-7.1.zip'

function eugeneware(target) {
    return {
        url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${EUGENEWARE_RELEASE}/ffmpeg-${target}.gz`,
        kind: 'gz',
    }
}

/**
 * Ordered candidate sources for a target. Later entries are fallbacks used only
 * if the earlier ones fail, so the highest-fidelity build comes first.
 */
export function getSources(platform, arch) {
    if (platform === 'win32') {
        if (arch === 'arm64') {
            return [
                {
                    url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${BTBN_WIN_ARM64_ASSET}`,
                    kind: 'zip',
                },
                // x64 runs under Windows' ARM emulation layer as a last resort.
                eugeneware('win32-x64'),
            ]
        }
        if (arch === 'x64' || arch === 'ia32') return [eugeneware('win32-x64')]
        return []
    }
    if (platform === 'darwin') {
        return [eugeneware(arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')]
    }
    if (platform === 'linux') {
        const supported = new Set(['x64', 'ia32', 'arm64', 'arm'])
        return supported.has(arch) ? [eugeneware(`linux-${arch}`)] : []
    }
    return []
}

export function getBinaryName(platform) {
    return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

/**
 * Extracts ffmpeg from a BtbN zip. The binary sits inside a versioned
 * directory whose name tracks the release, so it's located by search rather
 * than by a hardcoded path.
 */
async function extractFromZip(archivePath, platform) {
    const scratch = `${archivePath}-extract`
    await rm(scratch, { recursive: true, force: true })
    mkdirSync(scratch, { recursive: true })

    try {
        if (process.platform === 'win32') {
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
        } else {
            execFileSync('unzip', ['-q', '-o', archivePath, '-d', scratch], {
                stdio: 'ignore',
            })
        }

        const wanted = getBinaryName(platform)
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
 * Resolves ffmpeg for the target into the cache and returns its path. Cached
 * results are reused so repeated `forge make` runs don't refetch.
 */
export async function fetchFfmpeg(platform, arch, log = console.log) {
    const binName = getBinaryName(platform)
    const cacheDir = path.join(CACHE_ROOT, `${platform}-${arch}`)
    const cached = path.join(cacheDir, binName)

    if (existsSync(cached)) {
        log(`ffmpeg (${platform}-${arch}): using cached ${cached}`)
        return cached
    }

    const sources = getSources(platform, arch)
    if (sources.length === 0) {
        throw new Error(`No ffmpeg source known for ${platform}-${arch}`)
    }

    mkdirSync(cacheDir, { recursive: true })
    const errors = []

    for (const source of sources) {
        try {
            log(`ffmpeg (${platform}-${arch}): downloading ${source.url}`)
            const res = await fetch(source.url, { redirect: 'follow' })
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} ${res.statusText}`)
            }

            const downloaded = Buffer.from(await res.arrayBuffer())
            let binary

            if (source.kind === 'gz') {
                binary = gunzipSync(downloaded)
            } else {
                const archivePath = path.join(cacheDir, 'ffmpeg-archive.zip')
                await writeFile(archivePath, downloaded)
                try {
                    binary = await extractFromZip(archivePath, platform)
                } finally {
                    await rm(archivePath, { force: true })
                }
            }

            if (binary.length < 1_000_000) {
                throw new Error(
                    `Extracted ffmpeg is implausibly small (${binary.length} bytes)`,
                )
            }

            // Write then rename so an interrupted run never leaves a partial
            // binary that a later run would treat as a valid cache hit.
            const tmp = `${cached}.download`
            await writeFile(tmp, binary)
            await chmod(tmp, 0o755).catch(() => undefined)
            renameSync(tmp, cached)

            log(
                `ffmpeg (${platform}-${arch}): cached ${cached} (${(binary.length / 1e6).toFixed(1)} MB)`,
            )
            return cached
        } catch (err) {
            const message = err?.message || String(err)
            log(
                `ffmpeg (${platform}-${arch}): ${source.url} failed — ${message}`,
            )
            errors.push(`${source.url}: ${message}`)
        }
    }

    throw new Error(
        `Could not fetch ffmpeg for ${platform}-${arch}:\n  ${errors.join('\n  ')}`,
    )
}

// Direct invocation: node scripts/fetch-ffmpeg.mjs [platform] [arch]
if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    const platform = process.argv[2] || process.platform
    const arch = process.argv[3] || process.arch
    fetchFfmpeg(platform, arch).catch((err) => {
        console.error(err.message)
        process.exit(1)
    })
}
