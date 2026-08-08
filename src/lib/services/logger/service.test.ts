import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SessionLogger } from './service'

describe('SessionLogger', () => {
    let logsDir: string
    let downloadDir: string

    beforeEach(async () => {
        const base = path.join(os.tmpdir(), `fusegrab_test_logger_${Date.now()}`)
        logsDir = path.join(base, 'logs')
        downloadDir = path.join(base, 'Downloads')
        await mkdir(downloadDir, { recursive: true })
    })

    afterEach(async () => {
        await rm(path.dirname(logsDir), {
            recursive: true,
            force: true,
        }).catch(() => undefined)
    })

    const sessionLogs = () =>
        existsSync(logsDir)
            ? readdirSync(logsDir).filter((f) => f.startsWith('session-'))
            : []

    it('writes one file per session and deletes it on a clean end', () => {
        const logger = new SessionLogger(logsDir)
        logger.startSession('FuseGrab Application')

        logger.startDownload('Video A')
        logger.info('Resolving binary')
        logger.logStdoutLine('[download] 50% of 10MiB')
        logger.endDownload('Video A', true)

        expect(sessionLogs()).toHaveLength(1)

        logger.endSession(true)

        expect(sessionLogs()).toHaveLength(0)
    })

    it('keeps every download in a single file across the session', () => {
        const logger = new SessionLogger(logsDir)
        logger.startSession('FuseGrab Application')

        logger.startDownload('Video A')
        logger.info('First download')
        logger.endDownload('Video A', true)

        logger.startDownload('Video B')
        logger.info('Second download')
        logger.error('Failed to download', new Error('Network timeout'))
        logger.endDownload('Video B', false)

        expect(sessionLogs()).toHaveLength(1)
        const content = readFileSync(
            path.join(logsDir, sessionLogs()[0]),
            'utf-8',
        )
        expect(content).toContain('DOWNLOAD STARTED: Video A')
        expect(content).toContain('DOWNLOAD SUCCEEDED: Video A')
        expect(content).toContain('DOWNLOAD STARTED: Video B')
        expect(content).toContain('DOWNLOAD FAILED: Video B')
        expect(content).toContain('Network timeout')
    })

    it('retains the log at quit when any download in the session errored', () => {
        const logger = new SessionLogger(logsDir)
        logger.startSession('FuseGrab Application')

        logger.startDownload('Video A')
        logger.endDownload('Video A', true)

        logger.startDownload('Video B')
        logger.error('Boom', new Error('Network timeout'))
        logger.endDownload('Video B', false)

        // Quit reports success, but the earlier failure must still win.
        logger.endSession(true)

        expect(sessionLogs()).toHaveLength(1)
        const content = readFileSync(
            path.join(logsDir, sessionLogs()[0]),
            'utf-8',
        )
        expect(content).toContain('APP SESSION ENDED: FINISHED WITH ERRORS')
    })

    it('copies the log to the download root on error', () => {
        const logger = new SessionLogger(logsDir)
        logger.setDownloadRoot(downloadDir)
        logger.startSession('FuseGrab Application')

        logger.startDownload('Video A')
        logger.error('Boom', new Error('Network timeout'))
        logger.endDownload('Video A', false)
        logger.endSession(true)

        const copies = readdirSync(downloadDir).filter((f) =>
            f.startsWith('fusegrab-errors-'),
        )
        expect(copies).toHaveLength(1)
        expect(
            readFileSync(path.join(downloadDir, copies[0]), 'utf-8'),
        ).toContain('Network timeout')
    })

    it('does not copy anything to the download root on a clean session', () => {
        const logger = new SessionLogger(logsDir)
        logger.setDownloadRoot(downloadDir)
        logger.startSession('FuseGrab Application')
        logger.startDownload('Video A')
        logger.endDownload('Video A', true)
        logger.endSession(true)

        expect(readdirSync(downloadDir)).toHaveLength(0)
    })

    it('flags the session when yt-dlp writes an error to stderr', () => {
        const logger = new SessionLogger(logsDir)
        logger.startSession('FuseGrab Application')
        logger.logStderrLine('ERROR: unable to download video data')
        logger.endSession(true)

        expect(sessionLogs()).toHaveLength(1)
    })

    it('logs binary warnings without flagging the session', () => {
        const logger = new SessionLogger(logsDir)
        logger.startSession('FuseGrab Application')
        logger.warn(
            'Failed to download/load aria2 binary: HTTP 404 Not Found',
            new Error('HTTP 404'),
        )

        const logPath = path.join(logsDir, sessionLogs()[0])
        expect(readFileSync(logPath, 'utf-8')).toContain(
            '[WARN] Failed to download/load aria2 binary: HTTP 404 Not Found | Details: HTTP 404',
        )

        logger.endSession(true)
        expect(sessionLogs()).toHaveLength(0)
    })

    it('prunes old session logs down to the retention limit', () => {
        mkdirSync(logsDir, { recursive: true })
        // 12 stale error logs from previous sessions
        for (let i = 0; i < 12; i++) {
            const p = path.join(logsDir, `session-2026-01-0${i % 10}-old${i}.log`)
            writeFileSync(p, 'stale\n', { flag: 'w' })
        }
        expect(sessionLogs()).toHaveLength(12)

        // Constructing a new session prunes on startup
        const logger = new SessionLogger(logsDir)
        logger.startSession('FuseGrab Application')

        // 9 retained + the one this session just created
        expect(sessionLogs()).toHaveLength(10)
    })
})
