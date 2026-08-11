import type { SessionLogger } from '../logger/service'
import type { BrowserWindow } from 'electron'

import { execFile } from 'node:child_process'

import {
    detectInstalledBrowsers,
    getAntiRateLimitArgs,
    getJsRuntimeArgs,
} from './binary'

export interface YtDlpAttempt {
    label: string
    args: string[]
}

/**
 * Errors that mean "YouTube is fighting this request" rather than "this video
 * does not exist". Only these trigger the fallback ladder, so a genuinely
 * unavailable video fails fast instead of pointlessly retrying.
 */
const RETRY_PATTERNS = [
    /Sign in to confirm you're not a bot/i,
    /HTTP Error 429/i,
    /HTTP Error 403/i,
]

export function shouldRetryWithAlternative(errorMsg: string): boolean {
    return RETRY_PATTERNS.some((pattern) => pattern.test(errorMsg))
}

/**
 * Beyond the bot/rate-limit signals, a failed `--cookies-from-browser` attempt
 * (browser running, profile locked, cookies unreadable) is worth moving past —
 * the next browser on the list may work.
 */
export function shouldContinueToNextAttempt(errorMsg: string): boolean {
    if (shouldRetryWithAlternative(errorMsg)) return true
    return /cookies?/i.test(errorMsg)
}

/**
 * Builds the ordered retry ladder:
 * 1. standard request — anonymous visitor cookies + bundled JS runtime
 * 2. TV player client — no sign-in required, sidesteps the bot wall
 * 3. cookies from each installed browser, in preference order
 */
export async function buildYtDlpAttempts(
    win?: BrowserWindow | null,
    logger?: SessionLogger,
): Promise<YtDlpAttempt[]> {
    // Resolve both in parallel: the anti-rate-limit args (aria2, cookie jar)
    // and the JS runtime (deno) are independent of each other.
    const [baseArgs, jsRuntimeArgs] = await Promise.all([
        getAntiRateLimitArgs(win, logger),
        getJsRuntimeArgs(logger),
    ])

    const attempts: YtDlpAttempt[] = [
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

    for (const browser of detectInstalledBrowsers()) {
        const noJarArgs = await getAntiRateLimitArgs(win, logger, {
            includeCookieJar: false,
        })
        attempts.push({
            label: `cookies from ${browser}`,
            args: [
                ...noJarArgs,
                ...jsRuntimeArgs,
                '--cookies-from-browser',
                browser,
            ],
        })
    }

    return attempts
}

/**
 * Runs yt-dlp's JSON extractor across the retry ladder and returns the first
 * attempt's stdout. Throws the most useful failure: the first bot-check error
 * if there was one (so the user sees "sign in to confirm you're not a bot"
 * rather than a later browser-lock error), otherwise the last error seen.
 */
export async function runJsonAttempts(
    ytDlpPath: string,
    attempts: YtDlpAttempt[],
    extraArgs: string[],
    logger?: SessionLogger,
    maxBuffer = 50 * 1024 * 1024,
): Promise<string> {
    let lastError: Error | null = null
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
            lastError = error
            logger?.warn(`Attempt "${attempt.label}" failed: ${error.message}`)
            if (!botCheckError && shouldRetryWithAlternative(error.message)) {
                botCheckError = error
            }
            if (!shouldContinueToNextAttempt(error.message)) break
        }
    }

    throw (
        botCheckError ??
        lastError ??
        new Error('yt-dlp failed to produce output')
    )
}

/**
 * User-facing failure message from a yt-dlp download run, keeping the retry
 * signal (bot check / HTTP 429) visible even when it only appeared in a
 * WARNING line, which the user-facing stderr tail filters out.
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
    return message.trim()
}
