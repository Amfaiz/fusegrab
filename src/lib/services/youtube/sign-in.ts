import { BrowserWindow, session } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'

import { getPlatformUserAgent, getYtCookieJarPath } from './binary'

export interface YoutubeAccountInfo {
    name: string
    avatarUrl: string | null
    email: string | null
}

/**
 * Sign-in for YouTube.
 *
 * The sign-in happens in a stock-Chromium webview embedded in the renderer
 * (partition `persist:fusegrab-signin`), deliberately with no UA or
 * User-Agent-Client-Hints tampering: Google's login blocks embedded browsers
 * that fingerprint as neither Firefox nor Chrome (e.g. a Chrome UA with UA-CH
 * disabled, or a Firefox UA on a Chromium stack). A plain webview presents a
 * fully self-consistent Chrome fingerprint, exactly like the browser panel in
 * the recreate app does, and Google accepts it.
 *
 * A poll watches that partition's cookies for a youtube.com session
 * (SID/SAPISID/__Secure-1PSID); the moment one appears the app exports the
 * partition's cookies into the yt-dlp Netscape jar and reports 'signed-in'.
 * Nothing is read from the user's real browsers anymore.
 */

// Presence of any of these means the YouTube session is authenticated.
const LOGGED_IN_COOKIES = new Set(['SID', 'SAPISID', '__Secure-1PSID'])

// Deep-link straight into the Google login flow (continue → youtube.com/signin
// so the YouTube-side session cookies get set, not just google.com's).
const SIGN_IN_URL =
    'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Den%26next%3Dhttps%253A%252F%252Fwww.youtube.com%252F&hl=en&flowName=GlifWebSignIn&flowEntry=ServiceLogin&service=youtube'

// The webview's own persistent partition: its cookie store is separate from
// the app's, so sign-in cookies never leak into the app session.
export const SIGNIN_PARTITION = 'persist:fusegrab-signin'

const POLL_INTERVAL_MS = 3000
const POLL_ATTEMPTS = 120 // 6 minutes of checking before giving up

let signedInNotified = false
let polling = false
let cancelled = false
// Bumped on every open/cancel so a poll loop that is still sleeping can never
// resume after the user cancels and re-opens sign-in.
let pollGeneration = 0

function getSignInSession(): Electron.Session {
    return session.fromPartition(SIGNIN_PARTITION)
}

function readJarCookies(): Array<{
    name: string
    value: string
    domain: string
}> {
    const jarPath = getYtCookieJarPath()
    if (!existsSync(jarPath)) return []
    const cookies: Array<{ name: string; value: string; domain: string }> = []
    for (const line of readFileSync(jarPath, 'utf-8').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        // `#HttpOnly_` is a real record; every other `#` line is a comment.
        if (trimmed.startsWith('#') && !trimmed.startsWith('#HttpOnly_')) {
            continue
        }
        const fields = trimmed.split('\t')
        if (fields.length < 7) continue
        const domain = fields[0].startsWith('#HttpOnly_')
            ? fields[0].slice('#HttpOnly_'.length)
            : fields[0]
        cookies.push({ name: fields[5], value: fields[6], domain })
    }
    return cookies
}

/** Cookies scoped to youtube.com, as a real browser would send to it. */
function getYoutubeCookies() {
    return readJarCookies().filter((c) => {
        const domain = c.domain.replace(/^\./, '')
        return domain === 'youtube.com' || domain.endsWith('.youtube.com')
    })
}

export function isYoutubeSignedIn(): boolean {
    return getYoutubeCookies().some((c) => LOGGED_IN_COOKIES.has(c.name))
}

function emitState(status: 'opened' | 'signed-in' | 'closed' | 'signed-out') {
    // Broadcast to every window; the renderer is not necessarily the sender
    // (sign-out fires with no sign-in ever opened), so a single stored
    // reference would drop events.
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send('youtube:sign-in-state', {
                status,
                // The URL the renderer's webview should load for the flow.
                url: status === 'opened' ? SIGN_IN_URL : undefined,
            })
        }
    }
}

/** Does the sign-in partition hold a youtube.com session cookie yet? */
async function partitionHasYoutubeSession(): Promise<boolean> {
    const cookies = await getSignInSession().cookies.get({})
    return cookies.some(
        (c) =>
            LOGGED_IN_COOKIES.has(c.name) &&
            (c.domain ?? '').replace(/^\./, '').endsWith('youtube.com'),
    )
}

/**
 * Domain column in Netscape format. Electron reports host-only cookies
 * without a leading dot (accounts.google.com) and domain cookies with one
 * (.google.com), but Python's cookiejar (which yt-dlp uses) rejects a leading
 * dot on a multi-label subdomain — `.accounts.google.com` makes the whole jar
 * unreadable. Keep the dot only for registrable two-label domains, which is
 * what yt-dlp's own exports look like.
 */
function normalizeNetscapeDomain(domain: string): string {
    const bare = domain.replace(/^\./, '')
    return bare.split('.').length === 2 ? `.${bare}` : bare
}

/**
 * Export the sign-in partition's cookies into the yt-dlp Netscape jar. The
 * partition only ever holds Google/YouTube cookies, so exporting everything
 * gives yt-dlp the full session: SID/SAPISID for the account, VISITOR and
 * CONSENT for the anti-bot posture.
 */
async function exportPartitionCookiesToJar(): Promise<void> {
    const cookies = await getSignInSession().cookies.get({})
    if (cookies.length === 0) return

    const lines = [
        '# Netscape HTTP Cookie File',
        '# http://curl.haxx.se/rfc/cookie_spec.html',
        '# This is a generated file! Do not edit.',
        '',
    ]
    for (const c of cookies) {
        if (!c.value || !c.domain) continue
        const domain = normalizeNetscapeDomain(c.domain)
        lines.push(
            [
                c.httpOnly ? `#HttpOnly_${domain}` : domain,
                // includeSubdomains: only true for leading-dot domains.
                domain.startsWith('.') ? 'TRUE' : 'FALSE',
                c.path || '/',
                c.secure ? 'TRUE' : 'FALSE',
                c.expirationDate ? Math.floor(c.expirationDate) : 0,
                c.name,
                c.value,
            ].join('\t'),
        )
    }
    writeFileSync(getYtCookieJarPath(), lines.join('\n'), 'utf-8')
}

async function pollForSession(): Promise<void> {
    const generation = ++pollGeneration
    polling = true
    try {
        for (
            let i = 0;
            i < POLL_ATTEMPTS &&
            !cancelled &&
            !signedInNotified &&
            generation === pollGeneration;
            i++
        ) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
            if (cancelled || generation !== pollGeneration) return
            try {
                if (await partitionHasYoutubeSession()) {
                    await exportPartitionCookiesToJar()
                    if (isYoutubeSignedIn()) {
                        signedInNotified = true
                        emitState('signed-in')
                        return
                    }
                }
            } catch (err) {
                console.warn('[sign-in] poll failed:', err)
            }
        }
        if (!cancelled && generation === pollGeneration) {
            emitState('closed') // timed out without a session
        }
    } finally {
        if (generation === pollGeneration) polling = false
    }
}

export async function openYoutubeSignIn(): Promise<void> {
    if (polling) return // already in progress

    if (isYoutubeSignedIn()) {
        // A session already sits in the jar — nothing to do.
        emitState('signed-in')
        return
    }

    signedInNotified = false
    cancelled = false
    pollGeneration++
    emitState('opened')
    void pollForSession()
}

/** User pressed Cancel on the sign-in webview: stop the poll so a re-open
 * starts clean, and never emit 'closed' for a flow the user already ended. */
export function cancelYoutubeSignIn(): void {
    cancelled = true
    polling = false
    pollGeneration++
}

/**
 * The signed-in account's display name, avatar, and email, read from
 * YouTube's accounts_list API. The request is authorized with the standard
 * SAPISIDHASH header, which proves possession of the SAPISID cookie without
 * needing a browser session. Returns null when not signed in (or the API
 * refused to answer).
 */
export async function getYoutubeAccountInfo(): Promise<YoutubeAccountInfo | null> {
    try {
        const cookies = getYoutubeCookies()
        const sapisid = cookies.find(
            (c) => c.name === 'SAPISID' || c.name === '__Secure-1PAPISID',
        )?.value
        if (!sapisid) {
            console.error('[sign-in] accounts_list: no SAPISID in cookie jar')
            return null
        }

        const origin = 'https://www.youtube.com'
        const timestamp = Math.floor(Date.now() / 1000)
        const hash = createHash('sha1')
            .update(`${timestamp} ${sapisid} ${origin}`)
            .digest('hex')
        // youtube.com-scoped cookies only: the jar also carries cookies for
        // every other site the embedded sign-in visited (it can be 500KB+),
        // and a Cookie header built from all of it trips Google's
        // cookie-mismatch check (and blows HTTP/2 header size limits → 413).
        const cookieHeader = cookies
            .filter((c) => c.value)
            .map((c) => `${c.name}=${c.value}`)
            .join('; ')

        const res = await fetch(
            'https://www.youtube.com/youtubei/v1/account/accounts_list?prettyPrint=false',
            {
                method: 'POST',
                headers: {
                    // UA-CH is enabled app-wide, so the account-info call uses
                    // the app's real Chrome UA, which the sec-ch-ua* Client
                    // Hints it sends are consistent with.
                    'User-Agent': getPlatformUserAgent(),
                    'Content-Type': 'application/json',
                    Origin: origin,
                    'X-Origin': origin,
                    'X-Goog-AuthUser': '0',
                    'X-YouTube-Client-Name': '1',
                    'X-YouTube-Client-Version': '2.20250801.00.00',
                    Authorization: `SAPISIDHASH ${timestamp}_${hash}`,
                    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                },
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: 'WEB',
                            clientVersion: '2.20250801.00.00',
                        },
                    },
                }),
                signal: AbortSignal.timeout(15_000),
            },
        )
        if (!res.ok) {
            console.error(
                `[sign-in] accounts_list failed: HTTP ${res.status} ${res.statusText}`,
            )
            return null
        }
        const raw = await res.text()
        const data = JSON.parse(raw) as {
            accounts?: Array<{ name?: string; photo?: string; email?: string }>
            actions?: Array<{
                getMultiPageMenuAction?: {
                    menu?: {
                        multiPageMenuRenderer?: {
                            sections?: Array<{
                                accountSectionListRenderer?: {
                                    contents?: Array<{
                                        accountItemSectionRenderer?: {
                                            contents?: Array<{
                                                accountItem?: {
                                                    accountName?: {
                                                        simpleText?: string
                                                    }
                                                    accountPhoto?: {
                                                        thumbnails?: Array<{
                                                            url: string
                                                        }>
                                                    }
                                                }
                                            }>
                                        }
                                    }>
                                    header?: {
                                        googleAccountHeaderRenderer?: {
                                            email?: { simpleText?: string }
                                        }
                                    }
                                }
                            }>
                        }
                    }
                }
            }>
        }
        // Two shapes the endpoint returns depending on the request: an
        // `accounts` array, or the account-switcher menu with the current
        // account in the first section and the email in the header.
        const account = data.accounts?.[0]
        const menu =
            data.actions?.[0]?.getMultiPageMenuAction?.menu
                ?.multiPageMenuRenderer
        const section = menu?.sections?.[0]?.accountSectionListRenderer
        const item =
            section?.contents?.[0]?.accountItemSectionRenderer?.contents?.[0]
                ?.accountItem
        const name = account?.name ?? item?.accountName?.simpleText ?? null
        if (!name) {
            console.error(
                '[sign-in] accounts_list returned no account: ' +
                    raw.slice(0, 500),
            )
            return null
        }
        return {
            name,
            avatarUrl:
                account?.photo ??
                item?.accountPhoto?.thumbnails?.at(-1)?.url ??
                null,
            email:
                account?.email ??
                section?.header?.googleAccountHeaderRenderer?.email
                    ?.simpleText ??
                null,
        }
    } catch (err) {
        console.error('[sign-in] accounts_list threw:', err)
        return null
    }
}

/**
 * Drops the app's copy of the session: the jar and the embedded sign-in
 * partition's cookies, so the next sign-in starts fresh.
 */
export async function signOutYoutube(): Promise<void> {
    try {
        await rm(getYtCookieJarPath(), { force: true })
        await getSignInSession().clearStorageData({
            storages: ['cookies'],
        })
    } catch {}
    emitState('signed-out')
}

/** Shutdown: stop polling for a session. */
export function stopSignInPolling(): void {
    cancelled = true
}
