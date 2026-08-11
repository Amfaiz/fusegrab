import { execFile } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    buildFailureMessage,
    buildYtDlpAttempts,
    runJsonAttempts,
    shouldContinueToNextAttempt,
    shouldRetryWithAlternative,
} from './retry'

vi.mock('./binary', () => ({
    detectInstalledBrowsers: vi.fn(() => ['edge', 'chrome']),
    getAntiRateLimitArgs: vi.fn(
        async (_win: unknown, _logger: unknown, options?: any) =>
            options?.includeCookieJar === false
                ? ['--user-agent', 'test-ua']
                : ['--user-agent', 'test-ua', '--cookies', '/x/yt_cookies.txt'],
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
    it('continues past a locked/unreadable browser cookie store', () => {
        expect(
            shouldContinueToNextAttempt(
                'Unable to extract cookies from chrome: the browser is running',
            ),
        ).toBe(true)
    })
})

describe('buildYtDlpAttempts', () => {
    it('builds standard → TV client → per-browser cookie attempts', async () => {
        const attempts = await buildYtDlpAttempts()

        expect(attempts.map((a) => a.label)).toEqual([
            'standard request',
            'TV player client (no sign-in needed)',
            'cookies from edge',
            'cookies from chrome',
        ])

        const [standard, tv, edge, chrome] = attempts

        // Standard keeps the anonymous cookie jar
        expect(standard.args).toContain('--cookies')

        // TV client keeps the jar and adds the player-client override
        expect(tv.args).toContain('--cookies')
        expect(tv.args).toContain('--extractor-args')
        expect(tv.args).toContain('youtube:player_client=tv,web_embedded')

        // Browser attempts swap the jar for --cookies-from-browser (the two
        // flags are mutually exclusive in yt-dlp)
        expect(edge.args).toContain('--cookies-from-browser')
        expect(edge.args).toContain('edge')
        expect(edge.args).not.toContain('--cookies')

        expect(chrome.args).toContain('--cookies-from-browser')
        expect(chrome.args).toContain('chrome')
        expect(chrome.args).not.toContain('--cookies')

        // Every attempt still carries the JS runtime
        for (const a of attempts) {
            expect(a.args).toContain('--js-runtimes')
        }
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

    it('surfaces the first bot-check error when every attempt fails', async () => {
        mockedExecFile.mockImplementation((_f, _a, _o, cb: any) =>
            cb(
                new Error(
                    'Sign in to confirm you are not a bot. Use --cookies-from-browser or --cookies.',
                ),
            ),
        )

        await expect(
            runJsonAttempts('/x/yt-dlp', await buildYtDlpAttempts(), []),
        ).rejects.toThrow('Sign in to confirm you are not a bot')

        // standard + tv + edge + chrome = all four attempts ran
        expect(mockedExecFile).toHaveBeenCalledTimes(4)
    })

    it('moves past a locked-browser cookie failure to the next browser', async () => {
        mockedExecFile
            .mockImplementationOnce((_f, _a, _o, cb: any) =>
                cb(new Error("Sign in to confirm you're not a bot")),
            )
            .mockImplementationOnce((_f, _a, _o, cb: any) =>
                cb(new Error('Unable to extract cookies from edge')),
            )
            .mockImplementationOnce((_f, _a, _o, cb: any) =>
                cb(null, '{"title":"via chrome"}'),
            )

        const stdout = await runJsonAttempts(
            '/x/yt-dlp',
            await buildYtDlpAttempts(),
            [],
        )

        expect(stdout).toBe('{"title":"via chrome"}')
        expect(mockedExecFile).toHaveBeenCalledTimes(3)
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

        expect(msg).toContain('HTTP Error 429')
        expect(msg).toContain('failed')
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
