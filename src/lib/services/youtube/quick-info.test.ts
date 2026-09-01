import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getYoutubeQuickInfo } from './quick-info'
import * as videoService from './video'

describe('getYoutubeQuickInfo', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('resolves fast metadata via oEmbed when available', async () => {
        const mockOembed = {
            title: 'Sample Video Title',
            author_name: 'Sample Author',
            thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        }

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockOembed,
        } as any)

        const result = await getYoutubeQuickInfo(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        )

        expect(fetchSpy).toHaveBeenCalledTimes(1)
        expect(fetchSpy.mock.calls[0][0]).toContain('youtube.com/oembed')
        expect(result).toEqual({
            title: 'Sample Video Title',
            author: 'Sample Author',
            thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
            durationSeconds: 0,
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            formats: [],
        })
    })

    it('falls back to getYoutubeVideoInfo if oEmbed fails', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
            new Error('Network error'),
        )

        const fallbackInfo = {
            title: 'Fallback Video',
            thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
            durationSeconds: 120,
            author: 'Fallback Author',
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            formats: [],
        }

        const videoInfoSpy = vi
            .spyOn(videoService, 'getYoutubeVideoInfo')
            .mockResolvedValueOnce(fallbackInfo)

        const result = await getYoutubeQuickInfo(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        )

        expect(videoInfoSpy).toHaveBeenCalledWith(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            undefined,
        )
        expect(result).toEqual(fallbackInfo)
    })

    it('throws on empty or invalid URL', async () => {
        await expect(getYoutubeQuickInfo('')).rejects.toThrow(
            'Invalid YouTube video URL',
        )
    })
})
