import type { YoutubeChannelVideoItem } from './types'
import type { BrowserWindow } from 'electron'

import { getPlatformUserAgent } from './binary'

// Scraping runs in an offscreen BrowserWindow. Those count towards Electron's
// window list, so one left open stops `window-all-closed` from ever firing and
// the app never quits. Track them so shutdown can tear them all down.
const scraperWindows = new Set<BrowserWindow>()

export function destroyScraperWindows(): void {
    for (const win of scraperWindows) {
        try {
            win.destroy()
        } catch {}
    }
    scraperWindows.clear()
}

function trackScraperWindow(win: BrowserWindow): void {
    scraperWindows.add(win)
    win.on('closed', () => scraperWindows.delete(win))
}

export { trackScraperWindow as __trackScraperWindow }

function toChannelVideosUrl(raw: string): string {
    if (raw.includes('list=')) {
        const match = raw.match(/list=([a-zA-Z0-9_-]+)/)
        if (match) {
            return `https://www.youtube.com/playlist?list=${match[1]}`
        }
        return raw
    }
    const base = raw
        .replace(
            /\/(videos|shorts|streams|playlists|community|about|channels)\s*$/i,
            '',
        )
        .replace(/\/+$/, '')
    return `${base}/videos`
}

function parseDurationText(text: string): number {
    if (!text) return 0
    const clean = text.replace(/\s/g, '')
    const parts = clean.split(':').map(Number)
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return parts[0] || 0
}

export interface ChannelBatchEvent {
    channelUrl: string
    channelTitle: string
    videos: YoutubeChannelVideoItem[]
    isFirstBatch: boolean
    isDone: boolean
}

const EXTRACT_SCRIPT = `
    (() => {
        const isPlaylist = window.location.href.includes('list=') || !!document.querySelector('ytd-playlist-video-list-renderer');

        const channelTitle = (
            isPlaylist
                ? (
                    document.querySelector('ytd-playlist-header-renderer #text.ytd-channel-name')?.textContent ||
                    document.querySelector('ytd-playlist-header-renderer h1')?.textContent ||
                    document.querySelector('h1#title')?.textContent ||
                    document.querySelector('yt-dynamic-sizing-formatted-string#text')?.textContent ||
                    document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                    ''
                  )
                : (
                    document.querySelector('yt-dynamic-sizing-formatted-string#text')?.textContent ||
                    document.querySelector('h1#title')?.textContent ||
                    document.querySelector('yt-formatted-string#text.ytd-channel-name')?.textContent ||
                    document.querySelector('#channel-name yt-formatted-string')?.textContent ||
                    document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                    ''
                  )
        ).trim();

        const videos = [];
        const seen = new Set();

        let rawItems = [];
        if (isPlaylist) {
            // STRICTLY query ytd-playlist-video-renderer inside playlist container to avoid recommended sidebar items
            rawItems = Array.from(document.querySelectorAll(
                'ytd-playlist-video-list-renderer ytd-playlist-video-renderer, #contents.ytd-playlist-video-list-renderer ytd-playlist-video-renderer, ytd-playlist-video-renderer'
            ));
        } else {
            // Channel videos container
            rawItems = Array.from(document.querySelectorAll(
                '#contents.ytd-rich-grid-renderer ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-rich-item-renderer'
            ));
        }

        rawItems.forEach(item => {
            try {
                const link = item.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
                if (!link) return;
                const href = link.getAttribute('href') || link.href || '';
                const match = href.match(/(?:watch\\?v=|\\/shorts\\/)([a-zA-Z0-9_-]{11})/);
                if (!match) return;
                const videoId = match[1];
                if (seen.has(videoId)) return;

                let title = '';
                const titleEl = item.querySelector('#video-title, #video-title-link, a#video-title, yt-formatted-string#video-title');
                if (titleEl) {
                    title = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
                }
                if (!title) {
                    title = (link.getAttribute('title') || link.textContent || '').trim();
                }

                if (
                    !title ||
                    title.length < 2 ||
                    title.toLowerCase().includes(' - videos') ||
                    title.toLowerCase().includes(' - shorts') ||
                    /^(\\d+:\\d+|\\d+:\\d+:\\d+)$/.test(title)
                ) return;

                seen.add(videoId);

                let thumbnail = '';
                const thumbEl = item.querySelector('ytd-thumbnail img, img#img, img.yt-core-image');
                if (thumbEl) {
                    thumbnail = thumbEl.src || thumbEl.getAttribute('src') || '';
                }
                if (!thumbnail || thumbnail.startsWith('data:')) {
                    thumbnail = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
                }

                const durationEl = item.querySelector(
                    'ytd-thumbnail-overlay-time-status-renderer #text,' +
                    'ytd-thumbnail-overlay-time-status-renderer span, badge-shape .badge-shape-wiz__text,' +
                    'span.ytd-thumbnail-overlay-time-status-renderer'
                );
                const durationText = (durationEl?.textContent || '').trim();

                const authorEl = item.querySelector(
                    'ytd-channel-name #text a, ytd-channel-name a, #byline a, #owner-name a, #channel-name a'
                );
                const author = (authorEl?.textContent || channelTitle || 'YouTube').trim();

                videos.push({
                    id: videoId,
                    title: title || 'Untitled Video',
                    url: 'https://www.youtube.com/watch?v=' + videoId,
                    thumbnail,
                    durationText,
                    author,
                });
            } catch {}
        });

        // Method 2: Fallback ONLY for channel pages (NOT playlists)
        if (!isPlaylist && videos.length === 0) {
            const links = Array.from(document.querySelectorAll('a[href*="watch?v="]'));
            links.forEach(link => {
                try {
                    const href = link.getAttribute('href') || link.href || '';
                    const match = href.match(/watch\\?v=([a-zA-Z0-9_-]{11})/);
                    if (!match) return;
                    const videoId = match[1];
                    if (seen.has(videoId)) return;

                    const title = (link.getAttribute('title') || link.textContent || '').trim();
                    if (!title || title.length < 2 || /^(\\d+:\\d+|\\d+:\\d+:\\d+)$/.test(title)) return;

                    seen.add(videoId);
                    videos.push({
                        id: videoId,
                        title: title || 'Untitled Video',
                        url: 'https://www.youtube.com/watch?v=' + videoId,
                        thumbnail: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg',
                        durationText: '',
                        author: channelTitle || 'YouTube',
                    });
                } catch {}
            });
        }

        return { channelTitle, videos };
    })();
`

async function runBackgroundScrolling(
    win: any,
    url: string,
    channelTitle: string,
    targetNeeded: number,
    seenIds: Set<string>,
    initialCount: number,
    onBatch?: (event: ChannelBatchEvent) => void,
) {
    try {
        let scrollAttempts = 0
        let staleCount = 0
        let totalCount = initialCount
        let reachedEnd = false

        while (
            scrollAttempts < 5000 &&
            totalCount < targetNeeded &&
            !reachedEnd
        ) {
            // Shutdown destroys the window under us; stop instead of throwing
            // into the catch below on the next executeJavaScript call.
            if (win.isDestroyed()) return
            scrollAttempts++
            await win.webContents.executeJavaScript(`
                (() => {
                    const isPlaylist = window.location.href.includes('list=');
                    if (isPlaylist) {
                        const playlistContinuation = document.querySelector(
                            'ytd-playlist-video-list-renderer ytd-continuation-item-renderer, #contents.ytd-playlist-video-list-renderer ytd-continuation-item-renderer'
                        );
                        if (playlistContinuation) {
                            playlistContinuation.scrollIntoView({ behavior: 'instant', block: 'center' });
                        } else {
                            window.scrollTo(0, 999999);
                        }
                    } else {
                        const continuation = document.querySelector(
                            'ytd-continuation-item-renderer, tp-yt-paper-spinner'
                        );
                        if (continuation) {
                            continuation.scrollIntoView({ behavior: 'instant', block: 'center' });
                        }
                        window.scrollTo(0, 999999);
                    }
                    window.dispatchEvent(new Event('scroll', { bubbles: true }));
                })();
            `)

            await new Promise((res) => setTimeout(res, 600))

            const scraped =
                await win.webContents.executeJavaScript(EXTRACT_SCRIPT)
            const currentTitle = scraped?.channelTitle || channelTitle
            const currentRaw: any[] = scraped?.videos || []
            const newBatch: YoutubeChannelVideoItem[] = []

            for (const v of currentRaw) {
                if (totalCount >= targetNeeded) break
                if (!seenIds.has(v.id)) {
                    seenIds.add(v.id)
                    const parsed: YoutubeChannelVideoItem = {
                        id: v.id,
                        title: v.title,
                        url: v.url,
                        thumbnail: v.thumbnail,
                        durationSeconds: parseDurationText(
                            v.durationText || '',
                        ),
                        author: v.author,
                    }
                    newBatch.push(parsed)
                    totalCount++
                }
            }

            if (newBatch.length > 0) {
                staleCount = 0
                onBatch?.({
                    channelUrl: url,
                    channelTitle: currentTitle,
                    videos: newBatch,
                    isFirstBatch: false,
                    isDone: false,
                })
            } else {
                staleCount++
                if (staleCount >= 4) {
                    reachedEnd = true
                }
            }
        }
    } catch {
    } finally {
        onBatch?.({
            channelUrl: url,
            channelTitle,
            videos: [],
            isFirstBatch: false,
            isDone: true,
        })
        try {
            win.destroy()
        } catch {}
    }
}

export async function scrapeChannelWithBrowser(
    url: string,
    targetNeeded: number,
    onBatch?: (event: ChannelBatchEvent) => void,
): Promise<{
    channelTitle: string
    videos: YoutubeChannelVideoItem[]
    hasMore: boolean
} | null> {
    const { BrowserWindow, session } = await import('electron')
    const targetUrl = toChannelVideosUrl(url)
    const ses = session.fromPartition('persist:yt-scraper')

    // Pre-inject YouTube consent cookies to bypass popups instantly
    try {
        await ses.cookies.set({
            url: 'https://www.youtube.com',
            name: 'SOCS',
            value: 'CAESEwgDEgk2OTk4OTU1NjEaAmVuIAEaBgiA_K-1Bg',
            domain: '.youtube.com',
            path: '/',
        })
        await ses.cookies.set({
            url: 'https://www.youtube.com',
            name: 'CONSENT',
            value: 'YES+1',
            domain: '.youtube.com',
            path: '/',
        })
    } catch {}

    const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: {
            backgroundThrottling: false,
            session: ses,
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    trackScraperWindow(win)

    win.webContents.setAudioMuted(true)
    win.webContents.setUserAgent(getPlatformUserAgent())

    try {
        await win.loadURL(targetUrl)

        const hasVideos = await win.webContents.executeJavaScript(`
            new Promise((resolve) => {
                let attempts = 0;
                const check = () => {
                    const links = Array.from(document.querySelectorAll('a[href*="watch?v="]'));
                    const valid = links.some(a => {
                        const href = a.getAttribute('href') || a.href || '';
                        return /(?:watch\\?v=|\\/shorts\\/)([a-zA-Z0-9_-]{11})/.test(href);
                    });

                    if (valid) {
                        resolve(true);
                        return;
                    }
                    if (attempts > 24) {
                        resolve(false);
                        return;
                    }
                    attempts++;
                    setTimeout(check, 500);
                };
                check();
            });
        `)

        if (!hasVideos) {
            try {
                win.destroy()
            } catch {}
            return null
        }

        const scraped = await win.webContents.executeJavaScript(EXTRACT_SCRIPT)
        const channelTitle = scraped?.channelTitle || 'YouTube Playlist'
        const seenIds = new Set<string>()
        const firstBatch: YoutubeChannelVideoItem[] = []

        if (
            scraped &&
            Array.isArray(scraped.videos) &&
            scraped.videos.length > 0
        ) {
            for (const v of scraped.videos) {
                seenIds.add(v.id)
                firstBatch.push({
                    id: v.id,
                    title: v.title,
                    url: v.url,
                    thumbnail: v.thumbnail,
                    durationSeconds: parseDurationText(v.durationText || ''),
                    author: v.author,
                })
            }
            onBatch?.({
                channelUrl: url,
                channelTitle,
                videos: firstBatch,
                isFirstBatch: true,
                isDone: false,
            })
        }

        if (firstBatch.length === 0) {
            try {
                win.destroy()
            } catch {}
            return null
        }

        // Launch background scrolling non-blocking
        runBackgroundScrolling(
            win,
            url,
            channelTitle,
            targetNeeded,
            seenIds,
            firstBatch.length,
            onBatch,
        )

        return {
            channelTitle,
            videos: firstBatch,
            hasMore: true,
        }
    } catch {
        try {
            win.destroy()
        } catch {}
        return null
    }
}
