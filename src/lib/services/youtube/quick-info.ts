import type { YoutubeVideoInfo } from './types'
import type { BrowserWindow } from 'electron'

import { extractYoutubeVideoId } from './url'
import { getYoutubeVideoInfo } from './video'

/**
 * Rapidly retrieves video metadata (title, author, thumbnail) using YouTube's
 * lightweight public oEmbed endpoint (~50-100ms) without spawning yt-dlp, Deno,
 * or extracting full stream manifests. Falls back to getYoutubeVideoInfo if
 * oEmbed fails (e.g., age-restricted or private videos).
 */
export async function getYoutubeQuickInfo(
    url: string,
    win?: BrowserWindow | null,
): Promise<YoutubeVideoInfo> {
    const cleanUrl = url.trim()
    if (!cleanUrl) {
        throw new Error('Invalid YouTube video URL')
    }

    const videoId = extractYoutubeVideoId(cleanUrl)

    if (videoId) {
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
                `https://www.youtube.com/watch?v=${videoId}`,
            )}&format=json`

            const res = await fetch(oembedUrl, {
                signal: AbortSignal.timeout(4000),
            })

            if (res.ok) {
                const data = (await res.json()) as {
                    title?: string
                    author_name?: string
                    thumbnail_url?: string
                }

                if (
                    data &&
                    typeof data.title === 'string' &&
                    data.title.trim()
                ) {
                    return {
                        title: data.title.trim(),
                        thumbnail:
                            data.thumbnail_url ||
                            `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
                        durationSeconds: 0,
                        author: (data.author_name || 'YouTube').trim(),
                        url: cleanUrl,
                        formats: [],
                    }
                }
            }
        } catch {
            // oEmbed fetch failed or timed out; fall back to full extraction
        }
    }

    return getYoutubeVideoInfo(cleanUrl, win)
}
