export type LogLevel = 'INFO' | 'DEBUG' | 'WARN' | 'ERROR' | 'STDOUT' | 'STDERR'

export interface LogSessionOptions {
    sessionTitle: string
    details?: Record<string, any>
}
