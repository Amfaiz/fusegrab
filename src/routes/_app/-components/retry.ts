import type { DownloadItem } from './types'

import { MAX_RETRY_ATTEMPTS } from './types'

/**
 * Queue-advance policy, kept free of React state so it can be tested directly.
 *
 * Ordinary queued work always goes first. Only once the queue has drained do
 * items deferred by a failure get swept back in, least-attempted first: retries
 * then round-robin across items rather than hammering a single URL three times
 * back to back. The usual causes of a failed download here (throttling, YouTube
 * bot checks, CDN hiccups) need time to clear, so spacing matters.
 */
export function selectNextDownload(
    items: DownloadItem[],
    isPaused: (id: string) => boolean = () => false,
): { item: DownloadItem; kind: 'queued' | 'retry' } | null {
    const queued = items.find((i) => i.status === 'Queued' && !isPaused(i.id))
    if (queued) return { item: queued, kind: 'queued' }

    const retryable = items.filter(
        (i) =>
            i.status === 'Retry' &&
            (i.retryCount || 0) < MAX_RETRY_ATTEMPTS &&
            !isPaused(i.id),
    )
    if (retryable.length === 0) return null

    const item = retryable.reduce((best, i) =>
        (i.retryCount || 0) < (best.retryCount || 0) ? i : best,
    )
    return { item, kind: 'retry' }
}

/**
 * Apply a download failure. The item is parked as `Retry` until its budget is
 * spent, and only then becomes a terminal `Failed`.
 */
export function applyDownloadFailure(
    item: DownloadItem,
    message: string,
): DownloadItem {
    const attempts = item.retryCount || 0
    return {
        ...item,
        status: attempts >= MAX_RETRY_ATTEMPTS ? 'Failed' : 'Retry',
        statusStage: message || 'Download failed',
        retryCount: attempts,
    }
}
