export interface DownloadItem {
    id: string
    name: string
    url: string
    type: 'video' | 'channel'
    isSingleUrl?: boolean
    channelName?: string
    quality?: string
    size: string
    status:
        | 'Complete'
        | 'Downloading'
        | 'Paused'
        | 'Error'
        | 'Queued'
        | 'Missing'
        | 'Stopped'
        | 'Ready'
        | 'Retry'
        | 'Failed'
    statusStage?: string
    percent: number
    speed?: string
    timeLeft: string
    dateModified: string
    savePath?: string
    selected: boolean
    retryCount?: number
    section?: {
        startSeconds: number
        endSeconds: number
    }
}

export function formatTimeCode(
    totalSeconds: number,
    forceHours = false,
): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00'
    const s = Math.floor(totalSeconds)
    const hours = Math.floor(s / 3600)
    const minutes = Math.floor((s % 3600) / 60)
    const seconds = s % 60

    if (hours > 0 || forceHours) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function parseTimeCode(timeStr: string): number | null {
    if (!timeStr || typeof timeStr !== 'string') return null
    const cleaned = timeStr.trim()
    const parts = cleaned.split(/[:.]/).map((p) => Number(p.trim()))
    if (parts.some((p) => Number.isNaN(p) || p < 0)) return null

    if (parts.length === 1) {
        return parts[0]
    }
    if (parts.length === 2) {
        const [minutes, seconds] = parts
        if (seconds >= 60) return null
        return minutes * 60 + seconds
    }
    if (parts.length === 3) {
        const [hours, minutes, seconds] = parts
        if (minutes >= 60 || seconds >= 60) return null
        return hours * 3600 + minutes * 60 + seconds
    }
    return null
}

export function sanitizeFilename(name: string): string {
    return name.replace(/[/\\?%*:|"<>]/g, '').trim() || 'youtube-video'
}

export function formatDate(date: Date): string {
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${yyyy}/${mm}/${dd}`
}

/** A failed item gets this many additional attempts before it is marked Failed. */
export const MAX_RETRY_ATTEMPTS = 3

export function getStatusText(item: DownloadItem): string {
    if (item.status === 'Complete') return 'Complete'
    if (item.status === 'Queued') return 'Queued'
    if (item.status === 'Ready') return 'Ready'
    if (item.status === 'Missing') return 'Missing'
    if (item.status === 'Error') return item.statusStage || 'Error'
    if (item.status === 'Paused') return 'Paused'
    if (item.status === 'Stopped') return 'Stopped'

    if (item.status === 'Retry') {
        const attempt = item.retryCount || 0
        return attempt > 0
            ? `Retry at end (${attempt}/${MAX_RETRY_ATTEMPTS})`
            : 'Retry at end'
    }

    if (item.status === 'Failed') {
        return item.statusStage
            ? `Failed: ${item.statusStage}`
            : `Failed after ${MAX_RETRY_ATTEMPTS} retries`
    }

    if (item.status === 'Downloading') {
        if (item.statusStage) return item.statusStage
        if (!item.percent || item.percent <= 0) return 'Preparing...'
        if (item.percent >= 99) return 'Finalizing...'
        return `${Math.round(item.percent)}%`
    }

    if (item.statusStage) return item.statusStage
    return item.status
}
