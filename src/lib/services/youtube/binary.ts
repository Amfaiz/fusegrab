import type { SessionLogger } from '../logger/service'
import type { BrowserWindow } from 'electron'

import { app } from 'electron'
import { execFile } from 'node:child_process'
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
    const name = getBinaryName()
    return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`
}

export async function ensureYtDlpBinary(
    forceUpdate = false,
    logger?: SessionLogger,
): Promise<string> {
    const binDir = path.join(app.getPath('userData'), 'bin')
    const binName = getBinaryName()
    const binPath = path.join(binDir, binName)

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
                now - stat.mtimeMs > TWENTY_FOUR_HOURS_MS ||
                forceUpdate
            ) {
                logger?.info(
                    'yt-dlp binary is older than 24h or force update requested. Checking for update...',
                )
                needsDownload = true
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

            const tmpPath = `${binPath}.tmp_${now}`
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
        await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
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

const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

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
                  process.env['ProgramFiles(x86)'] ||
                      'C:\\Program Files (x86)',
                  'nodejs',
                  'node.exe',
              ),
              path.join(
                  process.env.APPDATA || '',
                  'npm',
                  'node.exe',
              ),
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
    const runtime = await resolveJsRuntime(logger)
    return runtime ? ['--js-runtimes', `node:${runtime}`] : []
}

export async function getAntiRateLimitArgs(
    win?: BrowserWindow | null,
    logger?: SessionLogger,
): Promise<string[]> {
    const userAgent =
        (win && !win.isDestroyed() && win.webContents.getUserAgent()) ||
        DEFAULT_USER_AGENT

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

    try {
        const { session } = await import('electron')
        const partitions = ['persist:yt-scraper']
        const allCookies: any[] = []
        const seenNames = new Set<string>()

        for (const part of partitions) {
            try {
                const ses = session.fromPartition(part)
                const cookies = await ses.cookies.get({
                    domain: '.youtube.com',
                })
                for (const c of cookies) {
                    if (!seenNames.has(c.name)) {
                        seenNames.add(c.name)
                        allCookies.push(c)
                    }
                }
            } catch {}
        }

        const cookieFilePath = path.join(
            app.getPath('userData'),
            'yt_cookies.txt',
        )

        // Merge: start with what yt-dlp has already accumulated
        const mergedJar = readExistingCookieJar(cookieFilePath)
        let overlayCount = 0

        // Overlay fresh Electron cookies on top
        for (const c of allCookies) {
            const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`
            const cookiePath = c.path || '/'
            const flag = 'TRUE'
            const secure = c.secure ? 'TRUE' : 'FALSE'
            const expiration = Math.floor(
                c.expirationDate || Date.now() / 1000 + 86400 * 365,
            )
            const line = `${domain}\t${flag}\t${cookiePath}\t${secure}\t${expiration}\t${c.name}\t${c.value}`
            mergedJar.set(cookieKey(domain, cookiePath, c.name), line)
            overlayCount++
        }

        if (mergedJar.size > 0) {
            const cookieLines = [...COOKIE_FILE_HEADER, ...mergedJar.values()]
            writeFileSync(cookieFilePath, cookieLines.join('\n'), 'utf-8')
            args.push('--cookies', cookieFilePath)
            logger?.info(
                `Merged ${mergedJar.size} cookies (${overlayCount} from Electron session, ${mergedJar.size - overlayCount} preserved from yt-dlp) into ${cookieFilePath}`,
            )
        }
    } catch (err: any) {
        logger?.warn(`Failed to export browser cookies: ${err?.message}`)
    }

    return args
}
