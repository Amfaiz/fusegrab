import type { SessionLogger } from '../logger/service'
import type { BrowserWindow } from 'electron'

import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import {
    createWriteStream,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs'
import { chmod, rename, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const FFMPEG_STATIC_RELEASE = 'b6.1.1'

/**
 * eugeneware/ffmpeg-static publishes no win32-arm64 asset — the b6.1.1 release
 * has ffmpeg-win32-x64 and nothing else for Windows. Asking it for
 * `ffmpeg-win32-arm64.gz` 404s, which is why merging silently failed on ARM
 * Windows: yt-dlp fetched video and audio as separate streams and left them
 * unmerged. BtbN is the maintained source of static Windows ARM64 builds.
 */
const BTBN_WIN_ARM64_ASSET = 'ffmpeg-n7.1-latest-winarm64-lgpl-7.1.zip'

/** Hiding the console keeps a window from flashing up per invocation on Windows. */
const NO_WINDOW = { windowsHide: true } as const

/**
 * Windows: `windowsHide` hides the console; `detached` is ignored (use taskkill).
 * POSIX: `detached` enables process-group kill; `windowsHide` is ignored.
 */
export function spawnOptions() {
    return process.platform === 'win32'
        ? { windowsHide: true }
        : { detached: true }
}

function getBinaryName(): string {
    if (process.platform === 'win32') return 'yt-dlp.exe'
    if (process.platform === 'darwin') return 'yt-dlp_macos'
    return 'yt-dlp'
}

function getDownloadUrl(): string {
    // The single-file macos asset (yt-dlp_macos) is a PyInstaller onefile
    // build that re-extracts ~38MB to a temp dir on every launch (~17s per
    // invocation). The onedir zip (yt-dlp_macos.zip) starts in ~0.2s. The zip
    // contains the binary plus its _internal/ directory.
    if (process.platform === 'darwin') {
        return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos.zip'
    }
    const name = getBinaryName()
    return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`
}

let pendingYtDlpDownload: Promise<string> | null = null

/**
 * True when GitHub's latest yt-dlp release differs from the installed one.
 * A null latest (GitHub unreachable) keeps the existing binary; a null local
 * (binary can't report a version) redownloads.
 */
export function ytDlpVersionNeedsUpdate(
    localVersion: string | null,
    latestVersion: string | null,
): boolean {
    if (latestVersion === null) return false
    if (localVersion === null) return true
    return localVersion.trim() !== latestVersion.trim()
}

async function getLocalYtDlpVersion(binPath: string): Promise<string | null> {
    try {
        const stdout = await new Promise<string>((resolve, reject) => {
            execFile(binPath, ['--version'], NO_WINDOW, (err, out) => {
                if (err || !out?.trim()) return reject(err)
                resolve(out.trim().split('\n')[0].trim())
            })
        })
        return stdout || null
    } catch {
        return null
    }
}

async function getLatestYtDlpVersion(): Promise<string | null> {
    try {
        const res = await fetch(
            'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
            {
                headers: { 'User-Agent': 'fusegrab' },
                signal: AbortSignal.timeout(10_000),
            },
        )
        if (!res.ok) return null
        const data = (await res.json()) as { tag_name?: unknown }
        return typeof data.tag_name === 'string' ? data.tag_name : null
    } catch {
        return null
    }
}

async function isYtDlpUpdateAvailable(
    binPath: string,
    logger?: SessionLogger,
): Promise<boolean> {
    const localVersion = await getLocalYtDlpVersion(binPath)
    const latestVersion = await getLatestYtDlpVersion()
    const needsUpdate = ytDlpVersionNeedsUpdate(localVersion, latestVersion)
    logger?.info(
        `yt-dlp version check: local ${localVersion ?? 'unknown'} vs latest ${latestVersion ?? 'unreachable'} — ${needsUpdate ? 'update available' : 'up to date'}`,
    )
    return needsUpdate
}

/** The onedir macos build lives in its own directory next to the other binaries. */
function getYtDlpBinPath(binDir: string): string {
    const binName = getBinaryName()
    return process.platform === 'darwin'
        ? path.join(binDir, 'yt-dlp', binName)
        : path.join(binDir, binName)
}

async function downloadYtDlp(
    binDir: string,
    binPath: string,
    logger?: SessionLogger,
): Promise<string> {
    mkdirSync(binDir, { recursive: true })

    try {
        const url = getDownloadUrl()
        logger?.info(`Downloading yt-dlp binary from ${url}...`)
        const res = await fetch(url)
        if (res.ok && res.body) {
            const buffer = Buffer.from(await res.arrayBuffer())
            if (buffer.length < 1000) {
                const errMsg =
                    'Downloaded yt-dlp binary is too small, likely corrupt'
                logger?.error(errMsg)
                throw new Error(errMsg)
            }

            if (process.platform === 'darwin') {
                // The macos asset is a zip containing the binary and its
                // _internal/ directory. Extract to a scratch dir, then swap it
                // into place so a failed download never leaves a partial
                // installation.
                const scratchDir = path.join(
                    binDir,
                    `.yt-dlp-tmp-${Date.now()}`,
                )
                mkdirSync(scratchDir, { recursive: true })
                const archivePath = path.join(scratchDir, 'yt-dlp.zip')
                writeFileSync(archivePath, buffer)
                await new Promise<void>((resolve, reject) => {
                    execFile(
                        'unzip',
                        ['-q', archivePath, '-d', scratchDir],
                        NO_WINDOW,
                        (err) => (err ? reject(err) : resolve()),
                    )
                })
                const extracted = path.join(scratchDir, getBinaryName())
                if (!existsSync(extracted)) {
                    throw new Error(
                        'yt-dlp binary was not found inside the extracted archive',
                    )
                }
                await chmod(extracted, 0o755)

                const finalDir = path.dirname(binPath)
                await rm(finalDir, { recursive: true, force: true }).catch(
                    () => undefined,
                )
                await rm(archivePath, { force: true }).catch(() => undefined)
                await rename(scratchDir, finalDir)
                // The legacy onefile build this replaces.
                await rm(path.join(binDir, getBinaryName()), {
                    force: true,
                }).catch(() => undefined)
                // First run after a fresh install pays a ~18s cold cost while
                // the OS pages in 177MB of new files. Run it once now, in the
                // background, so the user's first paste isn't the one that
                // pays it.
                execFile(binPath, ['--version'], NO_WINDOW, () => undefined)
                logger?.info(`yt-dlp binary updated successfully at ${binPath}`)
                return binPath
            }

            const tmpPath = `${binPath}.tmp_${Date.now()}`
            const ws = createWriteStream(tmpPath)
            await new Promise<void>((resolve, reject) => {
                ws.write(buffer, (writeErr) => {
                    if (writeErr) {
                        ws.destroy()
                        return reject(writeErr)
                    }
                    ws.end(() => resolve())
                })
                ws.on('error', reject)
            })

            if (process.platform !== 'win32') {
                await chmod(tmpPath, 0o755)
            }

            await rename(tmpPath, binPath)
            logger?.info(`yt-dlp binary updated successfully at ${binPath}`)
        } else {
            const errMsg = `Failed to fetch yt-dlp binary: HTTP ${res.status} ${res.statusText}`
            logger?.error(errMsg)
            throw new Error(errMsg)
        }
    } catch (err: any) {
        if (existsSync(binPath) && statSync(binPath).size > 1000) {
            logger?.warn(
                `Failed to download updated yt-dlp binary (${err?.message || String(err)}). Reusing existing binary at ${binPath}`,
            )
            return binPath
        }
        const errMsg = `Failed to download yt-dlp binary: ${err instanceof Error ? err.message : String(err)}`
        logger?.error(errMsg, err)
        throw new Error(errMsg)
    }

    return binPath
}

export async function ensureYtDlpBinary(
    forceUpdate = false,
    logger?: SessionLogger,
): Promise<string> {
    const binDir = path.join(app.getPath('userData'), 'bin')
    const binPath = getYtDlpBinPath(binDir)

    const now = Date.now()
    let needsDownload = true

    if (existsSync(binPath)) {
        try {
            const stat = statSync(binPath)
            // Treat empty or tiny files as corrupt
            if (stat.size < 1000) {
                logger?.warn(
                    `Existing yt-dlp binary at ${binPath} is corrupt or tiny (${stat.size} bytes). Redownloading...`,
                )
                needsDownload = true
            } else if (
                forceUpdate ||
                now - stat.mtimeMs > TWENTY_FOUR_HOURS_MS
            ) {
                // Version-compare rather than trusting mtime: the onedir
                // archive's entries carry the release build's mtime (not the
                // install time), so a freshly installed binary can look older
                // than 24h — treating that as "must download" re-fetched the
                // ~55MB archive on every launch and stalled the first getInfo
                // for ~50s while the download ran.
                needsDownload = await isYtDlpUpdateAvailable(binPath, logger)
            } else {
                logger?.info(`Using existing yt-dlp binary at: ${binPath}`)
                needsDownload = false
            }
        } catch (e: any) {
            logger?.warn(
                `Failed to stat yt-dlp binary at ${binPath}: ${e?.message}`,
            )
            needsDownload = true
        }
    } else {
        logger?.info(
            `yt-dlp binary not found at ${binPath}. Downloading latest release...`,
        )
    }

    if (!needsDownload) {
        return binPath
    }

    // Deduplicate: the startup pre-warm and a concurrent first user action
    // share one in-flight download instead of racing two.
    if (!pendingYtDlpDownload) {
        pendingYtDlpDownload = downloadYtDlp(binDir, binPath, logger).finally(
            () => {
                pendingYtDlpDownload = null
            },
        )
    } else {
        logger?.info('Reusing an in-flight yt-dlp download...')
    }
    return pendingYtDlpDownload
}

function getFfmpegBinaryName(): string {
    if (process.platform === 'win32') return 'ffmpeg.exe'
    return 'ffmpeg'
}

type FfmpegSource = { url: string; kind: 'gz' | 'zip' }

/**
 * Ordered download candidates, best first. Windows ARM64 gets a native BtbN
 * build, then falls back to the x64 static build, which Windows 11 on ARM runs
 * under emulation — slower than native, but it merges correctly, and a slow
 * merge beats no merge.
 */
function getFfmpegSources(): FfmpegSource[] {
    const { platform, arch } = process
    const eugeneware = (target: string): FfmpegSource => ({
        url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_STATIC_RELEASE}/ffmpeg-${target}.gz`,
        kind: 'gz',
    })

    if (platform === 'win32') {
        if (arch === 'arm64') {
            return [
                {
                    url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${BTBN_WIN_ARM64_ASSET}`,
                    kind: 'zip',
                },
                eugeneware('win32-x64'),
            ]
        }
        if (arch === 'x64' || arch === 'ia32') {
            return [eugeneware('win32-x64')]
        }
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

function getRealAsarPath(candidate: string): string {
    return candidate.replace(
        `${path.sep}app.asar${path.sep}`,
        `${path.sep}app.asar.unpacked${path.sep}`,
    )
}

function hasUsableBinary(
    candidate: string | null | undefined,
): candidate is string {
    if (!candidate) return false
    try {
        return existsSync(candidate) && statSync(candidate).size > 1000
    } catch {
        return false
    }
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const candidate of paths) {
        if (!candidate || seen.has(candidate)) continue
        seen.add(candidate)
        result.push(candidate)
    }
    return result
}

/**
 * Extract ffmpeg from a BtbN zip. The archive nests it at
 * `ffmpeg-<build>/bin/ffmpeg.exe`, so unpack to a scratch dir and hunt for the
 * executable rather than assuming the prefix.
 */
async function extractFfmpegFromZip(
    archivePath: string,
    binDir: string,
    logger?: SessionLogger,
): Promise<Buffer | null> {
    const scratch = path.join(binDir, `ffmpeg_unzip_${Date.now()}`)
    try {
        mkdirSync(scratch, { recursive: true })
        await new Promise<void>((resolve, reject) => {
            execFile(
                'powershell',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${scratch}" -Force`,
                ],
                NO_WINDOW,
                (err) => (err ? reject(err) : resolve()),
            )
        })

        const find = (dir: string): string | null => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) {
                    const hit = find(full)
                    if (hit) return hit
                } else if (entry.name.toLowerCase() === 'ffmpeg.exe') {
                    return full
                }
            }
            return null
        }

        const found = find(scratch)
        if (!found) {
            logger?.warn('ffmpeg.exe was not found inside the archive.')
            return null
        }
        return readFileSync(found)
    } finally {
        await rm(scratch, { recursive: true, force: true }).catch(
            () => undefined,
        )
        await rm(archivePath, { force: true }).catch(() => undefined)
    }
}

/**
 * Resolution is cached for the process lifetime. Without this, a failed lookup
 * re-ran the full probe — including a 404 fetch — once per video in a channel
 * download, which is what filled the session log with repeated HTTP 404 lines.
 */
let cachedFfmpegPath: string | null | undefined

export async function ensureFfmpegBinary(
    bundledPath?: string | null,
    logger?: SessionLogger,
): Promise<string | null> {
    if (cachedFfmpegPath !== undefined) {
        if (cachedFfmpegPath && hasUsableBinary(cachedFfmpegPath)) {
            return cachedFfmpegPath
        }
        if (cachedFfmpegPath === null) return null
    }

    const resolved = await resolveFfmpegBinary(bundledPath, logger)
    cachedFfmpegPath = resolved
    return resolved
}

async function resolveFfmpegBinary(
    bundledPath?: string | null,
    logger?: SessionLogger,
): Promise<string | null> {
    const binDir = path.join(app.getPath('userData'), 'bin')
    const binPath = path.join(binDir, getFfmpegBinaryName())
    const resourcesPath = (
        process as NodeJS.Process & { resourcesPath?: string }
    ).resourcesPath
    const resourceCandidates = resourcesPath
        ? [
              // Bundled by scripts/fetch-ffmpeg.mjs via extraResource.
              path.join(resourcesPath, 'ffmpeg', getFfmpegBinaryName()),
              path.join(
                  resourcesPath,
                  'app.asar.unpacked',
                  'node_modules',
                  'ffmpeg-static',
                  getFfmpegBinaryName(),
              ),
          ]
        : []

    for (const candidate of uniquePaths([
        process.env.FFMPEG_BIN,
        bundledPath,
        bundledPath ? getRealAsarPath(bundledPath) : null,
        ...resourceCandidates,
        binPath,
    ])) {
        if (hasUsableBinary(candidate)) {
            if (process.platform !== 'win32') {
                await chmod(candidate, 0o755).catch(() => undefined)
            }
            logger?.info(`Using ffmpeg binary at: ${candidate}`)
            return candidate
        }
    }

    try {
        const checkCmd = process.platform === 'win32' ? 'where' : 'which'
        const sysPath = await new Promise<string>((resolve, reject) => {
            execFile(
                checkCmd,
                [getFfmpegBinaryName()],
                NO_WINDOW,
                (err, stdout) => {
                    if (err || !stdout.trim()) return reject(err)
                    resolve(stdout.trim().split('\n')[0].trim())
                },
            )
        })
        if (hasUsableBinary(sysPath)) {
            logger?.info(`Using system ffmpeg binary at: ${sysPath}`)
            return sysPath
        }
    } catch {}

    const sources = getFfmpegSources()
    if (sources.length === 0) {
        logger?.warn(
            `Automatic ffmpeg download is not supported on ${process.platform}-${process.arch}.`,
        )
        return null
    }

    mkdirSync(binDir, { recursive: true })

    for (const source of sources) {
        try {
            logger?.info(`Downloading ffmpeg binary from ${source.url}...`)
            const res = await fetch(source.url, { redirect: 'follow' })
            if (!res.ok) {
                logger?.warn(
                    `Failed to fetch ffmpeg binary: HTTP ${res.status} ${res.statusText}`,
                )
                continue
            }

            const payload = Buffer.from(await res.arrayBuffer())
            let binary: Buffer | null
            if (source.kind === 'zip') {
                const archivePath = path.join(
                    binDir,
                    `ffmpeg_archive_${Date.now()}.zip`,
                )
                writeFileSync(archivePath, payload)
                binary = await extractFfmpegFromZip(archivePath, binDir, logger)
            } else {
                binary = gunzipSync(payload)
            }

            if (!binary || binary.length < 1000) {
                logger?.warn(
                    'Downloaded ffmpeg binary is too small, likely corrupt.',
                )
                continue
            }

            const tmpPath = `${binPath}.tmp_${Date.now()}`
            writeFileSync(tmpPath, binary)
            if (process.platform !== 'win32') {
                await chmod(tmpPath, 0o755)
            }
            await rename(tmpPath, binPath)
            logger?.info(`ffmpeg binary successfully installed at ${binPath}`)
            return binPath
        } catch (err: any) {
            logger?.warn(
                `Failed to download/load ffmpeg from ${source.url}: ${err?.message || String(err)}`,
                err,
            )
        }
    }

    if (hasUsableBinary(binPath)) return binPath

    logger?.error(
        'No ffmpeg binary could be resolved. Video and audio streams cannot be merged; downloads will fall back to a single pre-merged format.',
    )
    return null
}

function getAria2BinaryName(): string {
    if (process.platform === 'win32') return 'aria2c.exe'
    return 'aria2c'
}

export async function ensureAria2Binary(
    logger?: SessionLogger,
): Promise<string | null> {
    const binDir = path.join(app.getPath('userData'), 'bin')
    const binName = getAria2BinaryName()
    const binPath = path.join(binDir, binName)

    if (existsSync(binPath)) {
        try {
            const stat = statSync(binPath)
            if (stat.size > 1000) {
                logger?.info(`Found cached aria2c binary at: ${binPath}`)
                return binPath
            }
        } catch {}
    }

    try {
        const checkCmd = process.platform === 'win32' ? 'where' : 'which'
        const sysPath = await new Promise<string>((resolve, reject) => {
            execFile(checkCmd, [binName], NO_WINDOW, (err, stdout) => {
                if (err || !stdout.trim()) return reject(err)
                resolve(stdout.trim().split('\n')[0].trim())
            })
        })
        if (sysPath && existsSync(sysPath)) {
            logger?.info(`Found system aria2c binary at: ${sysPath}`)
            return sysPath
        }
    } catch {}

    logger?.info(
        'aria2c binary not found locally or in PATH. Attempting automatic download...',
    )
    try {
        mkdirSync(binDir, { recursive: true })
        let downloadUrl = ''
        if (process.platform === 'win32') {
            downloadUrl =
                'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip'
        } else if (process.platform === 'darwin') {
            const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
            downloadUrl = `https://github.com/q741451/aria2c-macos-standalone-binary/releases/download/v1.0.0/aria2c-macos-${arch}.tar.gz`
        } else {
            logger?.warn(
                'Automatic aria2 download is not supported on this platform.',
            )
            return null
        }

        logger?.info(`Downloading aria2 release archive from ${downloadUrl}...`)
        const res = await fetch(downloadUrl)
        if (!res.ok || !res.body) {
            const warnMsg = `Failed to fetch aria2 archive from ${downloadUrl}: HTTP ${res.status} ${res.statusText}`
            logger?.warn(warnMsg)
            return null
        }

        const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
        const tmpArchive = path.join(binDir, `aria2_archive.${ext}`)
        const buffer = Buffer.from(await res.arrayBuffer())

        await new Promise<void>((resolve, reject) => {
            const ws = createWriteStream(tmpArchive)
            ws.write(buffer, (writeErr) => {
                if (writeErr) {
                    ws.destroy()
                    return reject(writeErr)
                }
                ws.end(() => resolve())
            })
            ws.on('error', reject)
        })

        if (process.platform === 'win32') {
            logger?.info(
                'Extracting Windows aria2 zip archive via PowerShell...',
            )
            await new Promise((resolve, reject) => {
                execFile(
                    'powershell',
                    [
                        '-NoProfile',
                        '-NonInteractive',
                        '-Command',
                        `Expand-Archive -LiteralPath "${tmpArchive}" -DestinationPath "${binDir}" -Force`,
                    ],
                    NO_WINDOW,
                    (err) => (err ? reject(err) : resolve(true)),
                )
            })
        } else {
            logger?.info('Extracting macOS aria2 tar archive...')
            await new Promise((resolve, reject) => {
                execFile(
                    'tar',
                    ['-xzf', tmpArchive, '-C', binDir],
                    NO_WINDOW,
                    (err) => (err ? reject(err) : resolve(true)),
                )
            })
        }

        const findBinary = (dir: string): string | null => {
            const entries = readdirSync(dir)
            for (const entry of entries) {
                const full = path.join(dir, entry)
                if (entry.toLowerCase() === binName.toLowerCase()) return full
                if (statSync(full).isDirectory()) {
                    const found = findBinary(full)
                    if (found) return found
                }
            }
            return null
        }

        const foundBin = findBinary(binDir)
        if (foundBin && foundBin !== binPath) {
            await rename(foundBin, binPath).catch(() => undefined)
        }

        if (process.platform !== 'win32' && existsSync(binPath)) {
            await chmod(binPath, 0o755).catch(() => undefined)
        }

        await rm(tmpArchive, { force: true }).catch(() => undefined)

        if (existsSync(binPath)) {
            logger?.info(
                `aria2 binary successfully downloaded and installed at ${binPath}`,
            )
            return binPath
        } else {
            logger?.warn(
                'Extracted aria2 binary was not found at expected destination.',
            )
        }
    } catch (err: any) {
        logger?.warn(
            `Failed to download/load aria2 binary: ${err?.message || String(err)}. Falling back to standard downloader.`,
            err,
        )
    }

    return null
}

/**
 * A Chrome UA that matches the machine the app actually runs on — and the
 * Chromium version the app actually ships. Google's sign-in flow fingerprints
 * the browser: a UA string that contradicts the real build (e.g. a hardcoded
 * Chrome/131 on an Electron 33 build that is Chromium 130) trips its "this
 * browser or app may not be secure" check. Deriving from
 * `process.versions.chrome` keeps the presented UA consistent with the
 * `sec-ch-ua*` Client Hints the real build advertises, so it stays
 * self-consistent across Electron upgrades too.
 */
export function getPlatformUserAgent(): string {
    const chromeVersion = process.versions.chrome || '130.0.0.0'
    const chrome = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
    if (process.platform === 'win32') {
        return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome}`
    }
    if (process.platform === 'darwin') {
        return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${chrome}`
    }
    return `Mozilla/5.0 (X11; Linux x86_64) ${chrome}`
}

const NODE_FALLBACK_PATHS =
    process.platform === 'win32'
        ? [
              // Default installer location, plus the two common version managers.
              path.join(
                  process.env.ProgramFiles || 'C:\\Program Files',
                  'nodejs',
                  'node.exe',
              ),
              path.join(
                  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
                  'nodejs',
                  'node.exe',
              ),
              path.join(process.env.APPDATA || '', 'npm', 'node.exe'),
              path.join(
                  process.env.LOCALAPPDATA || '',
                  'fnm_multishells',
                  'node.exe',
              ),
              path.join(
                  process.env.LOCALAPPDATA || '',
                  'Volta',
                  'bin',
                  'node.exe',
              ),
          ]
        : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']

let cachedJsRuntime: string | null | undefined

/**
 * yt-dlp needs a JavaScript runtime to solve YouTube's player challenges.
 *
 * Passing a bare `--js-runtimes node` is unreliable in a packaged app: an app
 * launched from Finder/Dock inherits only a minimal PATH (/usr/bin:/bin:...),
 * so a version-manager node (nvm, fnm, volta) is invisible. yt-dlp then warns
 * "No supported JavaScript runtime could be found" and silently degrades to a
 * limited player client with a narrower format set.
 *
 * Resolve an absolute path instead, and omit the flag entirely rather than
 * pointing yt-dlp at a runtime that isn't there.
 */
async function resolveJsRuntime(
    logger?: SessionLogger,
): Promise<string | null> {
    if (cachedJsRuntime !== undefined) return cachedJsRuntime

    const candidates: Array<string | null> = [process.env.NODE_BIN || null]

    if (process.platform === 'win32') {
        // Windows has no login-shell equivalent, but it does inherit a usable
        // PATH from Explorer, so `where` is enough to find a managed node.
        try {
            const fromWhere = await new Promise<string>((resolve, reject) => {
                execFile('where', ['node.exe'], NO_WINDOW, (err, stdout) => {
                    if (err || !stdout.trim()) return reject(err)
                    resolve(stdout.trim().split('\n')[0].trim())
                })
            })
            candidates.push(fromWhere)
        } catch {}
    } else {
        // A login shell sources the user's profile, exposing nvm/fnm/volta shims
        // that the GUI process PATH does not have.
        try {
            const shell = process.env.SHELL || '/bin/zsh'
            const fromShell = await new Promise<string>((resolve, reject) => {
                execFile(
                    shell,
                    ['-lic', 'command -v node'],
                    NO_WINDOW,
                    (err, stdout) => {
                        if (err || !stdout.trim()) return reject(err)
                        resolve(stdout.trim().split('\n').pop()!.trim())
                    },
                )
            })
            candidates.push(fromShell)
        } catch {}
    }

    candidates.push(...NODE_FALLBACK_PATHS)

    for (const candidate of uniquePaths(candidates)) {
        if (hasUsableBinary(candidate)) {
            logger?.info(
                `Using JS runtime for YouTube challenges: ${candidate}`,
            )
            cachedJsRuntime = candidate
            return candidate
        }
    }

    logger?.warn(
        'No JavaScript runtime found. yt-dlp will fall back to a limited YouTube player client, which may offer fewer formats.',
    )
    cachedJsRuntime = null
    return null
}

const COOKIE_FILE_HEADER = [
    '# Netscape HTTP Cookie File',
    '# http://curl.haxx.se/rfc/cookie_spec.html',
    '# This is a generated file! Do not edit.',
    '',
]

/** Netscape cookie identity is the (domain, path, name) triple, not name alone. */
function cookieKey(domain: string, cookiePath: string, name: string): string {
    return `${domain}\t${cookiePath}\t${name}`
}

/**
 * yt-dlp writes back to the jar passed via `--cookies`, accumulating the
 * visitor-identity cookies YouTube's anti-bot keys on (VISITOR_INFO1_LIVE,
 * __Secure-ROLLOUT_TOKEN). Rebuilding the file from the Electron session alone
 * discards them, so every download presents a brand-new anonymous visitor from
 * the same IP -- the exact pattern that triggers "Sign in to confirm you're not
 * a bot". Read the existing jar so those entries survive.
 *
 * Lines are kept verbatim to preserve yt-dlp's `#HttpOnly_` domain prefix.
 */
function readExistingCookieJar(filePath: string): Map<string, string> {
    const existing = new Map<string, string>()
    if (!existsSync(filePath)) return existing

    const nowSeconds = Date.now() / 1000
    let raw: string
    try {
        raw = readFileSync(filePath, 'utf-8')
    } catch {
        return existing
    }

    for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        // `#HttpOnly_` is a real record; every other `#` line is a comment.
        if (trimmed.startsWith('#') && !trimmed.startsWith('#HttpOnly_')) {
            continue
        }

        const fields = trimmed.split('\t')
        if (fields.length < 7) continue

        const [domain, , cookiePath, , expiration, name] = fields
        // Expiration 0 means a session cookie, which never goes stale on disk.
        const expiresAt = Number(expiration)
        if (
            Number.isFinite(expiresAt) &&
            expiresAt > 0 &&
            expiresAt < nowSeconds
        ) {
            continue
        }

        existing.set(
            cookieKey(domain.replace(/^#HttpOnly_/, ''), cookiePath, name),
            trimmed,
        )
    }

    return existing
}

export async function getJsRuntimeArgs(
    logger?: SessionLogger,
): Promise<string[]> {
    // Deno is yt-dlp's default and best-supported runtime for YouTube's JS
    // challenges; node is the fallback when deno could not be installed.
    const denoPath = await ensureDenoBinary(logger)
    if (denoPath) {
        return ['--js-runtimes', `deno:${denoPath}`]
    }
    const runtime = await resolveJsRuntime(logger)
    return runtime ? ['--js-runtimes', `node:${runtime}`] : []
}

function getDenoBinaryName(): string {
    if (process.platform === 'win32') return 'deno.exe'
    return 'deno'
}

/**
 * The app cannot rely on the user having deno or node installed: a packaged
 * app launched from Finder/Dock or Explorer inherits a minimal PATH, and most
 * Windows users simply don't have node. So deno is downloaded next to yt-dlp,
 * exactly like the app already does for yt-dlp/ffmpeg/aria2.
 */
function getDenoDownloadAsset(): string | null {
    const { platform, arch } = process
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

function runExecFileQuiet(file: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(file, args, NO_WINDOW, (err) =>
            err ? reject(err) : resolve(),
        )
    })
}

function findFileRecursive(dir: string, targetName: string): string | null {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            const hit = findFileRecursive(full, targetName)
            if (hit) return hit
        } else if (entry.name.toLowerCase() === targetName.toLowerCase()) {
            return full
        }
    }
    return null
}

async function extractDenoArchive(
    archivePath: string,
    binDir: string,
    logger?: SessionLogger,
): Promise<string | null> {
    const targetName = getDenoBinaryName()
    const scratch = path.join(binDir, `deno_unzip_${Date.now()}`)
    try {
        mkdirSync(scratch, { recursive: true })
        if (process.platform === 'win32') {
            // Windows 10+ ships bsdtar, which reads zips and is far faster than
            // PowerShell's Expand-Archive. Fall back to PowerShell if absent.
            try {
                await runExecFileQuiet('tar', [
                    '-xf',
                    archivePath,
                    '-C',
                    scratch,
                ])
            } catch {
                await runExecFileQuiet('powershell', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${scratch}" -Force`,
                ])
            }
        } else {
            await runExecFileQuiet('unzip', ['-q', archivePath, '-d', scratch])
        }

        const found = findFileRecursive(scratch, targetName)
        if (!found) {
            logger?.warn(`${targetName} was not found inside the deno archive.`)
            return null
        }

        const dest = path.join(binDir, targetName)
        await rename(found, dest).catch(() => undefined)
        if (process.platform !== 'win32') {
            await chmod(dest, 0o755).catch(() => undefined)
        }
        return hasUsableBinary(dest) ? dest : null
    } finally {
        await rm(scratch, { recursive: true, force: true }).catch(
            () => undefined,
        )
        await rm(archivePath, { force: true }).catch(() => undefined)
    }
}

let cachedDenoPath: string | null | undefined

/**
 * Ensure a deno binary exists in the app's bin dir, downloading it once if
 * needed. yt-dlp needs a JS runtime to solve YouTube's player challenges;
 * without one it silently degrades to a limited player client and YouTube's
 * anti-bot escalates.
 */
export async function ensureDenoBinary(
    logger?: SessionLogger,
): Promise<string | null> {
    if (cachedDenoPath !== undefined) return cachedDenoPath

    // Bundled in the installer via scripts/fetch-deno.mjs → resources/deno/
    // (mirrors ffmpeg). Prefer it: zero first-run download in packaged builds.
    const resourcesPath = (
        process as NodeJS.Process & { resourcesPath?: string }
    ).resourcesPath
    const bundledPath = resourcesPath
        ? path.join(resourcesPath, 'deno', getDenoBinaryName())
        : null
    if (bundledPath && hasUsableBinary(bundledPath)) {
        if (process.platform !== 'win32') {
            await chmod(bundledPath, 0o755).catch(() => undefined)
        }
        logger?.info(`Using bundled deno JS runtime at: ${bundledPath}`)
        cachedDenoPath = bundledPath
        return bundledPath
    }

    const binDir = path.join(app.getPath('userData'), 'bin')
    const binPath = path.join(binDir, getDenoBinaryName())

    if (hasUsableBinary(binPath)) {
        logger?.info(`Found cached deno JS runtime at: ${binPath}`)
        cachedDenoPath = binPath
        return binPath
    }

    const asset = getDenoDownloadAsset()
    if (!asset) {
        logger?.warn(
            `Automatic deno download is not supported on ${process.platform}-${process.arch}.`,
        )
        cachedDenoPath = null
        return null
    }

    try {
        mkdirSync(binDir, { recursive: true })
        const url = `https://github.com/denoland/deno/releases/latest/download/${asset}`
        logger?.info(`Downloading deno JS runtime from ${url}...`)
        const res = await fetch(url, { redirect: 'follow' })
        if (!res.ok) {
            logger?.warn(
                `Failed to fetch deno archive: HTTP ${res.status} ${res.statusText}`,
            )
            cachedDenoPath = null
            return null
        }
        const payload = Buffer.from(await res.arrayBuffer())
        if (payload.length < 1_000_000) {
            logger?.warn(
                'Downloaded deno archive is too small, likely corrupt.',
            )
            cachedDenoPath = null
            return null
        }

        const archivePath = path.join(binDir, `deno_archive_${Date.now()}.zip`)
        writeFileSync(archivePath, payload)

        const installed = await extractDenoArchive(archivePath, binDir, logger)
        if (installed) {
            logger?.info(`deno JS runtime installed at ${installed}`)
            cachedDenoPath = installed
            return installed
        }
    } catch (err: any) {
        logger?.warn(
            `Failed to install deno JS runtime: ${err?.message || String(err)}`,
        )
    }

    cachedDenoPath = null
    return null
}

export async function getAntiRateLimitArgs(
    win?: BrowserWindow | null,
    logger?: SessionLogger,
    options?: { includeCookieJar?: boolean },
): Promise<string[]> {
    const includeCookieJar = options?.includeCookieJar ?? true
    const userAgent =
        (win && !win.isDestroyed() && win.webContents.getUserAgent()) ||
        getPlatformUserAgent()

    const args: string[] = [
        '--user-agent',
        userAgent,
        '--add-header',
        'Referer:https://www.youtube.com/',
        '--add-header',
        'Origin:https://www.youtube.com/',
        '--socket-timeout',
        '15',
        '--retries',
        '5',
        '--fragment-retries',
        '5',
        '--file-access-retries',
        '3',
    ]

    const aria2Path = await ensureAria2Binary(logger)
    if (aria2Path) {
        logger?.info(`Using aria2 accelerator binary at: ${aria2Path}`)
        args.push(
            '--external-downloader',
            `http,https:${aria2Path}`,
            '--external-downloader-args',
            'aria2c:-j 16 -x 16 -s 16 -k 1M --connect-timeout=5 --timeout=5 --max-tries=3 --summary-interval=1',
        )
    } else {
        logger?.info(
            'aria2 accelerator is unavailable. Using standard concurrent fragment downloader.',
        )
    }
    args.push('--concurrent-fragments', '5')

    if (includeCookieJar) {
        args.push(...(await getCookieJarArgs(logger)))
    }

    return args
}

/**
 * Point yt-dlp at the Netscape cookie jar. The jar is maintained by yt-dlp
 * itself: the browser-import step writes the signed-in session into it, and
 * downloads accumulate visitor identity cookies (VISITOR_INFO1_LIVE,
 * __Secure-ROLLOUT_TOKEN) back into it. This only prunes expired entries and
 * passes it through — nothing else in the app edits it. Discarding it would
 * present a brand-new anonymous visitor on every download, the exact pattern
 * that triggers "Sign in to confirm you're not a bot".
 */
async function getCookieJarArgs(logger?: SessionLogger): Promise<string[]> {
    const args: string[] = []
    try {
        const cookieFilePath = getYtCookieJarPath()
        if (!existsSync(cookieFilePath)) return args

        const jar = readExistingCookieJar(cookieFilePath)
        if (jar.size === 0) return args

        writeFileSync(
            cookieFilePath,
            [...COOKIE_FILE_HEADER, ...jar.values()].join('\n'),
            'utf-8',
        )
        args.push('--cookies', cookieFilePath)
        logger?.info(
            `Passing ${jar.size} cookies from ${cookieFilePath} to yt-dlp`,
        )
    } catch (err: any) {
        logger?.warn(`Failed to prepare cookie jar: ${err?.message}`)
    }
    return args
}

/** Location of the Netscape cookie jar shared with yt-dlp. */
export function getYtCookieJarPath(): string {
    return path.join(app.getPath('userData'), 'yt_cookies.txt')
}

/**
 * Browsers yt-dlp knows how to read cookies from (`--cookies-from-browser`),
 * in preference order. Detection is path-based so a failing attempt isn't
 * wasted on a browser that isn't installed. Safari is deliberately excluded on
 * macOS: reading its cookies needs Full Disk Access, which a packaged app does
 * not have by default.
 */
/** macOS app names for `open -Ra` / `open -a` lookups. */
export const MAC_BROWSER_APP_NAMES: Record<string, string> = {
    chrome: 'Google Chrome',
    edge: 'Microsoft Edge',
    brave: 'Brave Browser',
    firefox: 'Firefox',
}

let cachedDetectedBrowsers: string[] | null = null

/**
 * Browsers yt-dlp knows how to read cookies from (`--cookies-from-browser`),
 * in preference order. Path-based detection covers both /Applications and the
 * user's ~/Applications (many macOS installs are user-level); as a final,
 * authoritative check on macOS, `open -Ra` resolves the app regardless of
 * where it lives. Safari is deliberately last: reading its cookies needs Full
 * Disk Access, which the app cannot request automatically.
 *
 * Result is cached for the process lifetime (re-detect on next launch).
 */
export function detectInstalledBrowsers(): string[] {
    if (cachedDetectedBrowsers !== null) return cachedDetectedBrowsers

    const home = os.homedir()
    const candidates: Array<[string, string[]]> =
        process.platform === 'win32'
            ? [
                  [
                      'edge',
                      [
                          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
                      ],
                  ],
                  [
                      'chrome',
                      [
                          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                      ],
                  ],
                  [
                      'brave',
                      [
                          'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                      ],
                  ],
                  [
                      'firefox',
                      [
                          'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
                          'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
                      ],
                  ],
              ]
            : process.platform === 'darwin'
              ? [
                    [
                        'chrome',
                        [
                            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                            path.join(
                                home,
                                'Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                            ),
                        ],
                    ],
                    [
                        'edge',
                        [
                            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                            path.join(
                                home,
                                'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                            ),
                        ],
                    ],
                    [
                        'brave',
                        [
                            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
                            path.join(
                                home,
                                'Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
                            ),
                        ],
                    ],
                    [
                        'firefox',
                        [
                            '/Applications/Firefox.app/Contents/MacOS/firefox',
                            path.join(
                                home,
                                'Applications/Firefox.app/Contents/MacOS/firefox',
                            ),
                        ],
                    ],
                    [
                        // Always present on macOS; reading its cookies needs
                        // Full Disk Access, so it is tried last and fails with
                        // a tailored message.
                        'safari',
                        ['/Applications/Safari.app/Contents/MacOS/Safari'],
                    ],
                ]
              : [
                    [
                        'chromium',
                        ['/usr/bin/chromium', '/usr/bin/chromium-browser'],
                    ],
                    ['firefox', ['/usr/bin/firefox']],
                ]

    const found = candidates
        .filter(([, paths]) => paths.some((p) => p && existsSync(p)))
        .map(([name]) => name)

    // Authoritative fallback: `open -Ra` resolves an app anywhere on the
    // system, so a browser in an unusual location is still detected.
    if (process.platform === 'darwin') {
        for (const [name, appName] of Object.entries(MAC_BROWSER_APP_NAMES)) {
            if (found.includes(name)) continue
            try {
                execFileSync('open', ['-Ra', appName], {
                    stdio: 'ignore',
                    windowsHide: true,
                })
                found.push(name)
            } catch {
                // Not installed.
            }
        }
    }

    cachedDetectedBrowsers = found
    return found
}

/**
 * Background warm-up for the runtime binaries so the first paste or download
 * never blocks on a fetch. yt-dlp is version-checked on every startup
 * (forceUpdate) so YouTube-side breakage heals without waiting for the 24h
 * window; deno is bundled in the installer, so it is a no-op in packaged
 * builds. Shared promises mean a concurrent ensure* call awaits the same
 * in-flight download instead of starting a second one.
 */
export function prewarmYoutubeBinaries(
    logger?: SessionLogger,
): Promise<PromiseSettledResult<string | null>[]> {
    return Promise.allSettled([
        ensureYtDlpBinary(true, logger),
        ensureAria2Binary(logger),
        ensureDenoBinary(logger),
    ])
}
