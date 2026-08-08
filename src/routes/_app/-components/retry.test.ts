import type { DownloadItem } from './types'

import { describe, expect, it } from 'vitest'

import { applyDownloadFailure, selectNextDownload } from './retry'
import { MAX_RETRY_ATTEMPTS } from './types'

function makeItem(
    id: string,
    overrides: Partial<DownloadItem> = {},
): DownloadItem {
    return {
        id,
        name: id,
        url: `https://www.youtube.com/watch?v=${id}`,
        type: 'video',
        size: '0',
        status: 'Queued',
        percent: 0,
        timeLeft: '',
        dateModified: '2026/07/31',
        selected: false,
        ...overrides,
    }
}

describe('applyDownloadFailure', () => {
    it('defers a first failure to Retry rather than Error', () => {
        const result = applyDownloadFailure(makeItem('a'), 'HTTP 403')

        expect(result.status).toBe('Retry')
        expect(result.statusStage).toBe('HTTP 403')
        expect(result.retryCount).toBe(0)
    })

    it('marks Failed once the retry budget is spent', () => {
        const exhausted = makeItem('a', {
            status: 'Retry',
            retryCount: MAX_RETRY_ATTEMPTS,
        })

        expect(applyDownloadFailure(exhausted, 'HTTP 403').status).toBe(
            'Failed',
        )
    })

    it('falls back to a generic message when the error is empty', () => {
        expect(applyDownloadFailure(makeItem('a'), '').statusStage).toBe(
            'Download failed',
        )
    })
})

describe('selectNextDownload', () => {
    it('drains the queue before sweeping retries', () => {
        const next = selectNextDownload([
            makeItem('failed-earlier', { status: 'Retry', retryCount: 0 }),
            makeItem('still-queued'),
        ])

        expect(next).toMatchObject({ kind: 'queued' })
        expect(next?.item.id).toBe('still-queued')
    })

    it('picks the least-attempted item so retries round-robin', () => {
        const next = selectNextDownload([
            makeItem('twice', { status: 'Retry', retryCount: 2 }),
            makeItem('once', { status: 'Retry', retryCount: 1 }),
        ])

        expect(next?.item.id).toBe('once')
        expect(next?.kind).toBe('retry')
    })

    it('ignores items whose budget is exhausted', () => {
        expect(
            selectNextDownload([
                makeItem('a', {
                    status: 'Retry',
                    retryCount: MAX_RETRY_ATTEMPTS,
                }),
            ]),
        ).toBeNull()
    })

    it('skips paused items in both phases', () => {
        const items = [
            makeItem('queued-but-paused'),
            makeItem('retry-but-paused', { status: 'Retry', retryCount: 0 }),
        ]
        const isPaused = (id: string) => id.endsWith('paused')

        expect(selectNextDownload(items, isPaused)).toBeNull()
    })

    it('never returns terminal items', () => {
        expect(
            selectNextDownload([
                makeItem('done', { status: 'Complete' }),
                makeItem('dead', { status: 'Failed', retryCount: 3 }),
                makeItem('idle', { status: 'Ready' }),
            ]),
        ).toBeNull()
    })

    it('gives each failing item exactly 1 attempt plus MAX_RETRY_ATTEMPTS', () => {
        // Two permanently-failing items and one that succeeds on its 2nd try.
        let items = [
            makeItem('always-fails-a'),
            makeItem('succeeds-2nd'),
            makeItem('always-fails-b'),
        ]
        const attempts: Record<string, number> = {}
        const order: string[] = []

        for (let guard = 0; guard < 50; guard++) {
            const next = selectNextDownload(items)
            if (!next) break

            const id = next.item.id
            if (next.kind === 'retry') {
                items = items.map((i) =>
                    i.id === id
                        ? { ...i, retryCount: (i.retryCount || 0) + 1 }
                        : i,
                )
            }
            attempts[id] = (attempts[id] || 0) + 1
            order.push(id)

            const succeeds = id === 'succeeds-2nd' && attempts[id] >= 2
            items = items.map((i) => {
                if (i.id !== id) return i
                return succeeds
                    ? { ...i, status: 'Complete', retryCount: undefined }
                    : applyDownloadFailure(i, 'HTTP 403')
            })
        }

        expect(attempts['always-fails-a']).toBe(1 + MAX_RETRY_ATTEMPTS)
        expect(attempts['always-fails-b']).toBe(1 + MAX_RETRY_ATTEMPTS)
        expect(attempts['succeeds-2nd']).toBe(2)

        // Converged: no work left to hand out.
        expect(selectNextDownload(items)).toBeNull()
        expect(items.find((i) => i.id === 'always-fails-a')?.status).toBe(
            'Failed',
        )
        expect(items.find((i) => i.id === 'succeeds-2nd')?.status).toBe(
            'Complete',
        )

        // Retries interleave instead of clustering on one URL.
        const retryPhase = order.slice(3)
        expect(retryPhase).not.toEqual([
            'always-fails-a',
            'always-fails-a',
            'always-fails-a',
        ])
    })
})
