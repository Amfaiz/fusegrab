/**
 * Builds a yt-dlp `-f` selector.
 *
 * `bestvideo+bestaudio` gives the highest quality but yields two separate
 * streams that only ffmpeg can mux. When ffmpeg is unavailable, yt-dlp warns
 * and leaves the fragments on disk unmerged, so the expected output file never
 * appears and the download looks like a failure. Passing `canMerge: false`
 * restricts the selector to progressive (pre-merged) formats, which caps
 * quality at what YouTube serves in a single stream but always produces one
 * playable file.
 */
export function buildVideoFormatSelector(
    height?: number | null,
    canMerge = true,
): string {
    const targetHeight =
        typeof height === 'number' && Number.isFinite(height) && height > 0
            ? Math.floor(height)
            : null
    const heightFilter = targetHeight ? `[height<=${targetHeight}]` : ''

    const selectors = canMerge
        ? [
              `bestvideo${heightFilter}+bestaudio`,
              `bestvideo${heightFilter}[ext=mp4]+bestaudio[ext=m4a]`,
          ]
        : []

    if (targetHeight) {
        selectors.push(`best[height<=${targetHeight}]`)
    }
    selectors.push('best')

    return selectors.join('/')
}
