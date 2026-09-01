/**
 * Checks whether a given string is a valid YouTube URL (video, short, live,
 * playlist, channel, user, or handle).
 */
export function isValidYoutubeUrl(url: string | null | undefined): boolean {
    if (!url) return false
    const trimmed = url.trim()
    if (!trimmed) return false

    // Normalize protocol if missing so URL parser works properly
    const withProtocol = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`

    try {
        const parsed = new URL(withProtocol)
        const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')

        if (hostname === 'youtu.be') {
            const videoId = parsed.pathname.slice(1).split('/')[0]
            return Boolean(videoId && /^[a-zA-Z0-9_-]{6,}$/.test(videoId))
        }

        const isYoutubeHost =
            hostname === 'youtube.com' ||
            hostname.endsWith('.youtube.com') ||
            hostname === 'youtube-nocookie.com' ||
            hostname.endsWith('.youtube-nocookie.com')

        if (!isYoutubeHost) {
            return false
        }

        const pathname = parsed.pathname
        const searchParams = parsed.searchParams

        // 1. /watch?v=... or /watch?list=...
        if (pathname.startsWith('/watch')) {
            const v = searchParams.get('v')
            const list = searchParams.get('list')
            const hasValidV = Boolean(v && /^[a-zA-Z0-9_-]{6,}$/.test(v))
            const hasValidList = Boolean(list && list.trim().length > 0)
            return hasValidV || hasValidList
        }

        // 2. /shorts/<id>, /live/<id>, /embed/<id>, /v/<id>
        const directMatch = pathname.match(
            /^\/(?:shorts|live|embed|v)\/([a-zA-Z0-9_-]+)/i,
        )
        if (directMatch && directMatch[1]) {
            return directMatch[1].length >= 6
        }

        // 3. /playlist?list=...
        if (pathname.startsWith('/playlist')) {
            const list = searchParams.get('list')
            return Boolean(list && list.trim().length > 0)
        }

        // 4. Channel handle: /@handle (with optional /videos, /shorts, etc.)
        const handleMatch = pathname.match(/^\/@([a-zA-Z0-9_.-]+)/i)
        if (handleMatch && handleMatch[1] && handleMatch[1].length > 0) {
            return true
        }

        // 5. Channel / Custom / User: /channel/UC..., /c/..., /user/...
        const channelMatch = pathname.match(
            /^\/(?:channel|c|user)\/([a-zA-Z0-9_.-]+)/i,
        )
        if (channelMatch && channelMatch[1] && channelMatch[1].length > 0) {
            return true
        }

        return false
    } catch {
        return false
    }
}

/**
 * Splits multiline or newline-separated input into trimmed, non-empty URL strings,
 * removing duplicates while preserving the original order.
 */
export function parseYoutubeUrls(input: string | null | undefined): string[] {
    if (!input) return []
    const lines = input
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

    return Array.from(new Set(lines))
}

/**
 * Returns true if the input contains at least one URL and all non-empty URLs
 * are valid YouTube URLs.
 */
export function areAllValidYoutubeUrls(
    input: string | null | undefined,
): boolean {
    const urls = parseYoutubeUrls(input)
    if (urls.length === 0) return false
    return urls.every((url) => isValidYoutubeUrl(url))
}

/**
 * Returns an array of URLs from the input that failed YouTube URL validation.
 */
export function getInvalidYoutubeUrls(
    input: string | null | undefined,
): string[] {
    const urls = parseYoutubeUrls(input)
    return urls.filter((url) => !isValidYoutubeUrl(url))
}

/**
 * Extracts an 11-character YouTube video ID from various YouTube URL formats.
 */
export function extractYoutubeVideoId(
    url: string | null | undefined,
): string | null {
    if (!url) return null
    const trimmed = url.trim()
    if (!trimmed) return null

    const match = trimmed.match(
        /(?:watch\?v=|youtu\.be\/|\/(?:shorts|embed|live|v)\/)([a-zA-Z0-9_-]{11})/i,
    )
    if (match && match[1]) return match[1]

    try {
        const withProto = /^https?:\/\//i.test(trimmed)
            ? trimmed
            : `https://${trimmed}`
        const parsed = new URL(withProto)
        const v = parsed.searchParams.get('v')
        if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v
    } catch {}

    return null
}

