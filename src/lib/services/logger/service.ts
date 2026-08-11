import type { LogLevel } from './types'

import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type { LogLevel }

const MAX_ERROR_LOGS_TO_KEEP = 10

/**
 * Application-wide session logger. One log file per app launch, written to
 * userData/logs/ and optionally copied to the download root on error.
 */
export class SessionLogger {
    private logFilePath: string | null = null
    private downloadRootDir: string | null = null
    private hasError = false
    private active = false
    private sessionStartTime: string

    constructor(logsDir: string) {
        this.sessionStartTime = new Date()
            .toISOString()
            .replace(/[:.]/g, '-')
            .slice(0, 19)
        try {
            if (!existsSync(logsDir)) {
                mkdirSync(logsDir, { recursive: true })
            }
            this.logFilePath = path.join(
                logsDir,
                `session-${this.sessionStartTime}.log`,
            )
            this.active = true
            this.pruneOldErrorLogs(logsDir)
        } catch (e) {
            console.error('Failed to initialize SessionLogger:', e)
            this.active = false
        }
    }

    public get filePath(): string | null {
        return this.logFilePath
    }

    /**
     * Prune old session logs, keeping the most recent MAX_ERROR_LOGS_TO_KEEP
     * including the one this session is about to write. Clean sessions delete
     * their own log at quit, so what accumulates here is error logs.
     */
    private pruneOldErrorLogs(logsDir: string) {
        try {
            const files = readdirSync(logsDir)
                .filter((f) => f.startsWith('session-') && f.endsWith('.log'))
                .map((f) => ({
                    path: path.join(logsDir, f),
                    mtime: statSync(path.join(logsDir, f)).mtime.getTime(),
                }))
                .sort((a, b) => b.mtime - a.mtime)

            // -1 leaves room for the log this session is about to create.
            for (const file of files.slice(MAX_ERROR_LOGS_TO_KEEP - 1)) {
                try {
                    unlinkSync(file.path)
                } catch {
                    // A log held open elsewhere just survives to the next launch.
                }
            }
        } catch (e) {
            // Non-critical, don't block startup
            console.error('Failed to prune old logs:', e)
        }
    }

    public setDownloadRoot(dir: string) {
        this.downloadRootDir = dir
    }

    public startSession(sessionTitle: string, details?: Record<string, any>) {
        if (!this.active || !this.logFilePath) return
        const timestamp = new Date().toISOString()
        const banner = [
            '================================================================================',
            `[${timestamp}] STARTING SESSION: ${sessionTitle}`,
            `[${timestamp}] OS: ${process.platform} ${process.arch} (${os.release()})`,
            `[${timestamp}] Node: ${process.version}, Electron: ${process.versions.electron || 'N/A'}`,
            ...(details
                ? [
                      `[${timestamp}] Details: ${JSON.stringify(details, null, 2)}`,
                  ]
                : []),
            '================================================================================\n',
        ].join('\n')
        this.write(banner)
    }

    /**
     * Marks the start of one download within the session. Unlike startSession,
     * this does not reset error state — the session log spans every download.
     */
    public startDownload(title: string, details?: Record<string, any>) {
        if (!this.active || !this.logFilePath) return
        const timestamp = new Date().toISOString()
        const banner = [
            '\n--------------------------------------------------------------------------------',
            `[${timestamp}] DOWNLOAD STARTED: ${title}`,
            ...(details
                ? [
                      `[${timestamp}] Details: ${JSON.stringify(details, null, 2)}`,
                  ]
                : []),
            '--------------------------------------------------------------------------------',
        ].join('\n')
        this.write(banner + '\n')
    }

    /**
     * Marks the end of one download. A failure here flags the whole session as
     * errored so the log survives quit, but does not close the log.
     */
    public endDownload(title: string, wasSuccessful = true) {
        if (!this.active || !this.logFilePath) return
        if (!wasSuccessful) {
            this.hasError = true
        }
        const timestamp = new Date().toISOString()
        const status = wasSuccessful ? 'SUCCEEDED' : 'FAILED'
        this.write(
            `[${timestamp}] DOWNLOAD ${status}: ${title}\n` +
                '--------------------------------------------------------------------------------\n',
        )
    }

    public info(message: string) {
        this.log('INFO', message)
    }

    public debug(message: string) {
        this.log('DEBUG', message)
    }

    public warn(message: string, errorObj?: any) {
        let warnDetails = message
        if (errorObj) {
            if (errorObj instanceof Error) {
                warnDetails += ` | Details: ${errorObj.message}`
            } else {
                warnDetails += ` | Details: ${String(errorObj)}`
            }
        }
        this.log('WARN', warnDetails)
    }

    public error(message: string, errorObj?: any) {
        this.hasError = true
        let errorDetails = message
        if (errorObj) {
            if (errorObj instanceof Error) {
                errorDetails += ` | Error: ${errorObj.message}\nStack: ${errorObj.stack}`
            } else {
                errorDetails += ` | Error: ${String(errorObj)}`
            }
        }
        this.log('ERROR', errorDetails)
    }

    public logStdoutLine(line: string) {
        const trimmed = line.trim()
        if (!trimmed) return
        if (/ERROR:/i.test(trimmed) || /\[error\]/i.test(trimmed)) {
            this.hasError = true
        }
        this.log('STDOUT', trimmed)
    }

    public logStderrLine(line: string) {
        const trimmed = line.trim()
        if (!trimmed) return
        if (
            /ERROR:/i.test(trimmed) ||
            /fatal:/i.test(trimmed) ||
            /\[error\]/i.test(trimmed)
        ) {
            this.hasError = true
        }
        this.log('STDERR', trimmed)
    }

    private log(level: LogLevel, message: string) {
        if (!this.active || !this.logFilePath) return
        const timestamp = new Date().toISOString()
        const formatted = `[${timestamp}] [${level}] ${message}\n`
        this.write(formatted)
    }

    private write(data: string) {
        if (!this.logFilePath) return
        try {
            appendFileSync(this.logFilePath, data, 'utf-8')
        } catch (e) {
            console.error('Failed writing to session log:', e)
        }
    }

    public endSession(wasSuccessful = true): void {
        if (!this.active || !this.logFilePath) return
        this.active = false

        if (!wasSuccessful) {
            this.hasError = true
        }

        const timestamp = new Date().toISOString()
        const endStatus = this.hasError
            ? 'FINISHED WITH ERRORS'
            : 'COMPLETED SUCCESSFULLY'
        const footer = [
            `\n================================================================================`,
            `[${timestamp}] APP SESSION ENDED: ${endStatus}`,
            `[${timestamp}] Canonical log: ${this.logFilePath}`,
            ...(this.hasError && this.downloadRootDir
                ? [
                      `[${timestamp}] Error copy will be saved to: ${path.join(
                          this.downloadRootDir,
                          `fusegrab-errors-${this.sessionStartTime}.log`,
                      )}`,
                  ]
                : []),
            '================================================================================\n',
        ].join('\n')

        this.write(footer)

        if (this.hasError && this.downloadRootDir) {
            try {
                const errorLogPath = path.join(
                    this.downloadRootDir,
                    `fusegrab-errors-${this.sessionStartTime}.log`,
                )
                if (!existsSync(this.downloadRootDir)) {
                    mkdirSync(this.downloadRootDir, { recursive: true })
                }
                // Synchronous copy so Electron quit doesn't interrupt us
                const content = readFileSync(this.logFilePath, 'utf-8')
                writeFileSync(errorLogPath, content, 'utf-8')
            } catch (e) {
                console.error('Failed to copy error log to download root:', e)
            }
        }

        if (
            !this.hasError &&
            this.logFilePath &&
            existsSync(this.logFilePath)
        ) {
            try {
                unlinkSync(this.logFilePath)
            } catch (e) {
                console.error('Failed to remove clean session log:', e)
            }
        }
    }
}

// Global singleton instance. main.ts calls initSessionLogger() at app ready
// with Electron's userData path; the download services just call
// getSessionLogger() and get that same instance.
let sessionLogger: SessionLogger | null = null

export function initSessionLogger(logsDir: string): SessionLogger {
    sessionLogger = new SessionLogger(logsDir)
    return sessionLogger
}

export function getSessionLogger(): SessionLogger {
    if (!sessionLogger) {
        // Fallback for any path that logs before init (shouldn't normally hit).
        sessionLogger = new SessionLogger(
            path.join(os.tmpdir(), 'fusegrab-logs'),
        )
    }
    return sessionLogger
}

export function shutdownLogger(): void {
    if (sessionLogger) {
        sessionLogger.endSession(true)
    }
}
