/**
 * Builds a yt-dlp `-f` selector.
 *
 * `bestvideo+bestaudio` gives the highest quality but yields two separate
 * streams that only ffmpeg can mux. When ffmpeg is unavailable, yt-dlp warns
 * and leaves the fragments on disk unmerged, so the expected output file never
 * appears and the download looks like a failure. Passing `canMerge: false`
 * For MP4 playback compatibility across all default media players (QuickTime
 * on macOS, Windows Media Player / Films & TV on Windows, iOS, TVs), we
 * prioritize AAC audio (`bestaudio[ext=m4a]`) and MP4 video before generic
 * `bestaudio`. YouTube's default highest-bitrate audio stream is Opus (`.webm`),
 * which causes native OS media players to silently skip the audio track when
 * merged into an `.mp4` container.
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
              `bestvideo${heightFilter}[ext=mp4]+bestaudio[ext=m4a]`,
              `bestvideo${heightFilter}+bestaudio[ext=m4a]`,
              `bestvideo${heightFilter}+bestaudio`,
          ]
        : []

    if (targetHeight) {
        selectors.push(`best[height<=${targetHeight}]`)
    }
    selectors.push('best')

    return selectors.join('/')
}
