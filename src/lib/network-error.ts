// Centralized detection and messaging for "this machine has no internet"
// failures. Imported by both the main process (to classify thrown errors
// before they cross IPC) and the renderer (to strip Electron's
// "Error invoking remote method '<channel>'" wrapper and surface a single
// human-readable message instead of internal method names / "AggregateError").

export const NETWORK_ERROR_MESSAGE =
    'No internet connection. Please check your network and try again.'

// Node/undici system error codes that mean the request never reached a server
// (DNS failure, no route, refused or timed-out sockets).
const NETWORK_CODES = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ENETDOWN',
    'EHOSTUNREACH',
    'EHOSTDOWN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
])

// Message fragments (lower-cased) that indicate the same class of failure.
// fetch() surfaces these as a TypeError "fetch failed", and Chromium net
// stack errors show up in the renderer as "net::ERR_*".
const NETWORK_TEXT = [
    'fetch failed',
    'failed to fetch',
    'getaddrinfo',
    'network error',
    'network request failed',
    'enotfound',
    'eai_again',
    'network is unreachable',
    'net::err_internet_disconnected',
    'net::err_name_not_resolved',
    'net::err_network_changed',
    'net::err_address_unreachable',
    'net::err_connection_',
    'net::err_proxy_connection_failed',
]

function matchesNetworkText(text: string): boolean {
    const lower = text.toLowerCase()
    return NETWORK_TEXT.some((fragment) => lower.includes(fragment))
}

// Walks the `cause` chain (and any AggregateError sub-errors) looking for a
// signal that the failure is a missing/unreachable network rather than a real
// application error.
export function isNetworkError(err: unknown): boolean {
    if (typeof err === 'string') return matchesNetworkText(err)

    const seen = new Set<unknown>()
    let current: unknown = err
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current)
        const e = current as {
            code?: unknown
            name?: unknown
            message?: unknown
            errors?: unknown
            cause?: unknown
        }
        if (typeof e.code === 'string' && NETWORK_CODES.has(e.code)) return true
        // undici throws an (often message-less) AggregateError when every
        // resolved address fails — that is exactly the offline case.
        if (e.name === 'AggregateError') return true
        if (typeof e.message === 'string' && matchesNetworkText(e.message))
            return true
        if (Array.isArray(e.errors) && e.errors.some(isNetworkError))
            return true
        current = e.cause
    }
    return false
}

// Main-process helper: collapse any network failure into a single clean Error
// so the message that crosses IPC (and gets stored on a session) is friendly.
export function toFriendlyError(err: unknown): Error {
    if (isNetworkError(err)) return new Error(NETWORK_ERROR_MESSAGE)
    if (err instanceof Error) return err
    return new Error(String(err))
}

// Strips Electron's IPC wrapper, e.g.
// "Error invoking remote method 'voices:preview': <message>".
const IPC_INVOKE_PREFIX = /^Error invoking remote method '[^']*':\s*/

// Renderer helper: turn any caught value into the message to show the user.
// Detects offline state from navigator, the normalized main-process message,
// and raw network markers that may slip through, returning a single clear
// "no internet" line instead of internal channel names.
export function friendlyErrorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err)
    const stripped = raw.replace(IPC_INVOKE_PREFIX, '').trim()

    const offline =
        typeof navigator !== 'undefined' && navigator.onLine === false
    if (
        offline ||
        stripped === NETWORK_ERROR_MESSAGE ||
        isNetworkError(stripped) ||
        isNetworkError(err)
    ) {
        return NETWORK_ERROR_MESSAGE
    }

    return stripped || 'Something went wrong'
}
