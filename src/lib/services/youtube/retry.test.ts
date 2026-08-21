import { execFile } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    buildFailureMessage,
    buildYtDlpAttempts,
    humanizeSessionError,
    runJsonAttempts,
    shouldContinueToNextAttempt,
    shouldRetryWithAlternative,
} from './retry'

vi.mock('./sign-in', () => ({
    notifyIfSessionExpired: vi.fn(),
}))

vi.mock('./binary', () => ({
    detectInstalledBrowsers: vi.fn(() => []),
    getAntiRateLimitArgs: vi.fn(
        async () => ['--user-agent', 'test-ua', '--cookies', '/x/yt_cookies.txt'],
    ),
    getJsRuntimeArgs: vi.fn(async () => ['--js-runtimes', 'deno:/x/deno']),
}))

vi.mock('node:child_process', () => ({
    execFile: vi.fn(),
}))

const mockedExecFile = vi.mocked(execFile)

describe('shouldRetryWithAlternative', () => {
    it('matches the YouTube bot check', () => {
        expect(
            shouldRetryWithAlternative(
                "ERROR: [youtube] xyz: Sign in to confirm you're not a bot.",
            ),
        ).toBe(true)
    })

    it('matches HTTP 429 and 403', () => {
        expect(
            shouldRetryWithAlternative('HTTP Error 429: Too Many Requests'),
        ).toBe(true)
        expect(shouldRetryWithAlternative('HTTP Error 403: Forbidden')).toBe(
            true,
        )
    })

    it('does not match unrelated failures', () => {
        expect(
            shouldRetryWithAlternative(
                'Video unavailable. This video is private.',
            ),
        ).toBe(false)
        expect(shouldRetryWithAlternative('Unsupported URL')).toBe(false)
    })
})

describe('shouldContinueToNextAttempt', () => {
    it('continues past a YouTube-side block', () => {
        expect(
            shouldContinueToNextAttempt(
                "Sign in to confirm you're not a bot",
            ),
        ).toBe(true)
        expect(shouldContinueToNextAttempt('HTTP Error 429')).toBe(true)
    })

    it('stops on ordinary failures', () => {
        expect(
            shouldContinueToNextAttempt('Video unavailable'),
        ).toBe(false)
    })
})

describe('humanizeSessionError', () => {
    it('translates the bot check into an actionable instruction', () => {
        const msg = humanizeSessionError(
            "Sign in to confirm you're not a bot.",
        )
        expect(msg).toContain('session may have expired')
        expect(msg).not.toContain('--cookies')
    })

    it('translates 403 and 429', () => {
        expect(humanizeSessionError('HTTP Error 429: Too Many Requests'))
            .toContain('rate-limiting')
        expect(humanizeSessionError('HTTP Error 403: Forbidden')).toContain(
            '403',
        )
    })

    it('leaves unrelated errors alone', () => {
        expect(humanizeSessionError('Video unavailable')).toBeNull()
    })
})

describe('buildYtDlpAttempts', () => {
    it('builds standard → TV client with the signed-in jar on both', async () => {
        const attempts = await buildYtDlpAttempts()

        expect(attempts.map((a) => a.label)).toEqual([
            'standard request',
            'TV player client (no sign-in needed)',
        ])

        // The per-browser --cookies-from-browser fallbacks are gone: sign-in
        // is mandatory, so no other browser's cookie store is ever read.
        for (const a of attempts) {
            expect(a.args).toContain('--cookies')
            expect(a.args).not.toContain('--cookies-from-browser')
            expect(a.args).toContain('--js-runtimes')
        }

        expect(attempts[1].args).toContain('--extractor-args')
        expect(attempts[1].args).toContain(
            'youtube:player_client=tv,web_embedded',
        )
    })
})

describe('runJsonAttempts', () => {
    beforeEach(() => {
        mockedExecFile.mockReset()
    })

    it('retries with the next attempt on a bot check and returns the first success', async () => {
        mockedExecFile
            .mockImplementationOnce((_f, _a, _o, cb: any) =>
                cb(new Error("Sign in to confirm you're not a bot")),
            )
            .mockImplementationOnce((_f, _a, _o, cb: any) =>
                cb(null, '{"title":"ok"}'),
            )

        const stdout = await runJsonAttempts(
            '/x/yt-dlp',
            await buildYtDlpAttempts(),
            ['--dump-single-json', 'https://youtube.com/watch?v=abc'],
        )

        expect(stdout).toBe('{"title":"ok"}')
        expect(mockedExecFile).toHaveBeenCalledTimes(2)
    })

    it('fails fast when the error is not retryable', async () => {
        mockedExecFile.mockImplementationOnce((_f, _a, _o, cb: any) =>
            cb(new Error('Video unavailable. This video is private.')),
        )

        await expect(
            runJsonAttempts('/x/yt-dlp', await buildYtDlpAttempts(), []),
        ).rejects.toThrow('Video unavailable. This video is private.')

        expect(mockedExecFile).toHaveBeenCalledTimes(1)
    })

    it('surfaces a humanized message when every attempt is bot-walled', async () => {
        mockedExecFile.mockImplementation((_f, _a, _o, cb: any) =>
            cb(
                new Error(
                    'Sign in to confirm you are not a bot. Use --cookies-from-browser or --cookies.',
                ),
            ),
        )

        await expect(
            runJsonAttempts('/x/yt-dlp', await buildYtDlpAttempts(), []),
        ).rejects.toThrow(/rejecting this request as automated/)

        // standard + tv = both attempts ran
        expect(mockedExecFile).toHaveBeenCalledTimes(2)
    })
})

describe('buildFailureMessage', () => {
    it('keeps a bot-check WARNING visible in the failure message', () => {
        const stderrLines = ['ERROR: [youtube] abc: failed']
        const rawStderrLines = [
            'WARNING: [youtube] abc: Unable to download webpage: HTTP Error 429: Too Many Requests',
            'ERROR: [youtube] abc: failed',
        ]

        const msg = buildFailureMessage(stderrLines, rawStderrLines, 1)

        expect(msg).toContain('rate-limiting')
        expect(msg).not.toContain('HTTP Error 429')
    })

    it('uses the plain stderr tail when nothing retry-worthy happened', () => {
        const msg = buildFailureMessage(
            ['Video unavailable'],
            ['Video unavailable'],
            1,
        )
        expect(msg).toBe('Video unavailable')
    })
})
