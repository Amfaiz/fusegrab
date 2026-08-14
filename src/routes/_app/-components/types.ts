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
