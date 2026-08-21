import type { SessionLogger } from '../logger/service'
import type { BrowserWindow } from 'electron'

import { execFile } from 'node:child_process'

import { getAntiRateLimitArgs, getJsRuntimeArgs } from './binary'
import { notifyIfSessionExpired } from './sign-in'

export interface YtDlpAttempt {
    label: string
    args: string[]
}

/**
 * Errors that mean "YouTube is fighting this request" rather than "this video
 * does not exist". Only these trigger the fallback ladder, so a genuinely
 * unavailable video fails fast instead of pointlessly retrying.
 */
const BOT_CHECK_PATTERN = /Sign in to confirm you(?:'re| are) not a bot/i

const RETRY_PATTERNS = [BOT_CHECK_PATTERN, /HTTP Error 429/i, /HTTP Error 403/i]

export function shouldRetryWithAlternative(errorMsg: string): boolean {
    return RETRY_PATTERNS.some((pattern) => pattern.test(errorMsg))
}

/**
 * The user-facing version of a YouTube-side block. The raw yt-dlp lines name
 * internal flags (--cookies-from-browser) and HTTP codes; what the user needs
 * to know is "your session is being rejected — refresh it".
 */
export function humanizeSessionError(errorMsg: string): string | null {
    if (BOT_CHECK_PATTERN.test(errorMsg)) {
        notifyIfSessionExpired()
        return (
            'YouTube is rejecting this request as automated. Your session may ' +
            'have expired or been flagged — sign out and sign back in from the ' +
            'account menu, then retry.'
        )
    }
    if (/HTTP Error 429/i.test(errorMsg)) {
        return (
            'YouTube is rate-limiting your network (too many requests). Wait a ' +
            'few minutes before retrying.'
        )
    }
    if (/HTTP Error 403/i.test(errorMsg)) {
        notifyIfSessionExpired()
        return (
            'YouTube refused this request (403). This usually means the session ' +
            'was rejected — sign out and sign back in from the account menu, ' +
            'then retry.'
        )
    }
    return null
}

export function shouldContinueToNextAttempt(errorMsg: string): boolean {
    return shouldRetryWithAlternative(errorMsg)
}

/**
 * Builds the ordered retry ladder:
 * 1. standard request — signed-in session cookies + bundled JS runtime
 * 2. TV player client — different player pipeline, often not bot-walled
 *
 * The old per-browser `--cookies-from-browser` fallbacks are gone: sign-in is
 * mandatory, so the app's own jar always carries a session, and reading other
 * browsers' cookie stores was the source of locked-database and app-bound
 * encryption failures (yt-dlp issue #7271).
 */
export async function buildYtDlpAttempts(
    win?: BrowserWindow | null,
    logger?: SessionLogger,
): Promise<YtDlpAttempt[]> {
    // Resolve both in parallel: the anti-rate-limit args (cookie jar)
    // and the JS runtime (deno) are independent of each other.
    const [baseArgs, jsRuntimeArgs] = await Promise.all([
        getAntiRateLimitArgs(win, logger),
        getJsRuntimeArgs(logger),
    ])

    return [
        {
            label: 'standard request',
            args: [...baseArgs, ...jsRuntimeArgs],
        },
        {
            label: 'TV player client (no sign-in needed)',
            args: [
                ...baseArgs,
                ...jsRuntimeArgs,
                '--extractor-args',
                'youtube:player_client=tv,web_embedded',
            ],
        },
    ]
}

/**
 * Runs yt-dlp's JSON extractor across the retry ladder and returns the first
 * attempt's stdout. Throws the most useful failure: the first bot-check error
 * if there was one (so the user sees "sign in to confirm you're not a bot"
 * rather than a later error), otherwise the first other error seen.
 */
export async function runJsonAttempts(
    ytDlpPath: string,
    attempts: YtDlpAttempt[],
    extraArgs: string[],
    logger?: SessionLogger,
    maxBuffer = 50 * 1024 * 1024,
): Promise<string> {
    let lastError: Error | null = null
    let firstOtherError: Error | null = null
    let botCheckError: Error | null = null

    for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i]
        logger?.info(
            `yt-dlp JSON attempt ${i + 1}/${attempts.length}: ${attempt.label}`,
        )
        try {
            return await new Promise<string>((resolve, reject) => {
                execFile(
                    ytDlpPath,
                    [...attempt.args, ...extraArgs],
                    { maxBuffer },
                    (err, out) => {
                        if (err) {
                            reject(
                                new Error(
                                    err.message ||
                                        `yt-dlp exited with ${err.code ?? 'an error'}`,
                                ),
                            )
                            return
                        }
                        resolve(out)
                    },
                )
            })
        } catch (err: any) {
            const error = err instanceof Error ? err : new Error(String(err))
            logger?.warn(`Attempt "${attempt.label}" failed: ${error.message}`)
            if (shouldRetryWithAlternative(error.message)) {
                botCheckError ??= error
            } else {
                firstOtherError ??= error
            }
            if (!shouldContinueToNextAttempt(error.message)) break
        }
    }

    const failure = botCheckError ?? firstOtherError ?? lastError
    if (!failure) throw new Error('yt-dlp failed to produce output')
    return Promise.reject(
        new Error(humanizeSessionError(failure.message) ?? failure.message),
    )
}

/**
 * User-facing failure message from a yt-dlp download run, keeping the retry
 * signal (bot check / HTTP 429) visible even when it only appeared in a
 * WARNING line, which the user-facing stderr tail filters out. YouTube-side
 * blocks are replaced with an actionable instruction instead of raw yt-dlp
 * output.
 */
export function buildFailureMessage(
    stderrLines: string[],
    rawStderrLines: string[],
    exitCode: number | null,
): string {
    let message =
        stderrLines.length > 0
            ? stderrLines.slice(-3).join(' ')
            : `yt-dlp exited with code ${exitCode ?? 'unknown'}`
    const rawTail = rawStderrLines.slice(-8).join(' ')
    if (
        shouldRetryWithAlternative(rawTail) &&
        !shouldRetryWithAlternative(message)
    ) {
        message = `${rawTail} ${message}`
    }
    return humanizeSessionError(message) ?? message.trim()
}
