export interface ProgressWeight {
    start: number
    end: number
}

/** Percent from a `[download] 42.3% of ...` (yt-dlp) or `[#id ...] 42.3%` (aria2) progress line. */
export function parseYtDlpPercent(line: string): number | null {
    const ytDlpMatch = line.match(/\[download\]\s+([\d.]+)%/)
    if (ytDlpMatch) {
        if (isHlsStartGlitch(line)) return null
        const val = parseFloat(ytDlpMatch[1])
        return Number.isNaN(val) ? null : val
    }

    const aria2Match =
        line.match(/\[#\w+.*?\(([\d.]+)%\)/) ||
        line.match(/\[#\w+.*?\s+([\d.]+)%/)
    if (aria2Match) {
        const val = parseFloat(aria2Match[1])
        return Number.isNaN(val) ? null : val
    }

    return null
}

/**
 * yt-dlp's hlsnative downloader prints a placeholder progress line before any
 * fragment is fetched: `100.0% of ~ 1.00KiB at ... (frag 0/190)`. The percent
 * is bogus — downloaded and total are the same ~1KiB placeholder — and letting
 * it through would pin the bar at 100% before real progress starts. No real
 * line can be near-100% with zero fragments completed, so that combination
 * isolates the glitch.
 */
export function isHlsStartGlitch(line: string): boolean {
    const percentMatch = line.match(/\[download\]\s+([\d.]+)%/)
    if (!percentMatch) return false
    const percent = parseFloat(percentMatch[1])
    return !Number.isNaN(percent) && percent >= 99.5 && /frag\s+0\//.test(line)
}

/**
 * Stateful guard for the same hlsnative placeholder, covering variants the
 * line-based `isHlsStartGlitch` cannot see (different fragment phrasing, no
 * `(frag 0/N)` suffix). A near-100% value is only trusted once real progress
 * (<99.5%) has been observed in the current stream; call reset() when a new
 * stream starts, since each stream's first lines repeat the placeholder.
 */
export function createStartPercentGuard(): {
    accept: (percent: number) => boolean
    reset: () => void
} {
    let seenRealProgress = false
    return {
        accept(percent: number): boolean {
            if (percent >= 99.5 && !seenRealProgress) return false
            if (percent < 99.5) seenRealProgress = true
            return true
        },
        reset() {
            seenRealProgress = false
        },
    }
}

/**
 * Number of 0-100% download streams yt-dlp will run this run, from the
 * `[info] <id>: Downloading N format(s): ...` line printed before downloading.
 * N counts comma-separated entries, not streams: `395+251` is N=1 but a
 * video+audio pair downloaded as two sequential streams, while a single
 * combined format (progressive, or the tv-downgraded-player HLS streams
 * YouTube serves for older shows) is one stream. Ground truth for how many
 * 0-100% streams to expect is the number of `+`/`,`-separated parts in the
 * format list. Returns null until the line is seen.
 */
export function parseStreamCount(line: string): number | null {
    const match = line.match(/Downloading (\d+) format\(s\)(?::\s*(.*))?/)
    if (!match) return null
    if (match[2]) {
        const streams = match[2].split(/[+,]/).filter((p) => p.trim() !== '')
            .length
        if (streams > 0) return streams
    }
    const count = parseInt(match[1], 10)
    return Number.isNaN(count) ? null : count
}

/**
 * Each download stream maps onto a slice of the 0-100 bar so a second stream
 * doesn't reset it. A single-format download (audio-only or a combined HLS
 * format) owns the whole bar; video+audio splits into 0-80 (video) and 80-95
 * (audio), leaving 95-100 for the ffmpeg merge.
 */
export function buildStreamWeights(
    expectedStreams: number,
    isAudioOnly: boolean,
): ProgressWeight[] {
    if (isAudioOnly || expectedStreams <= 1) {
        return [{ start: 0, end: 100 }]
    }
    return [
        { start: 0, end: 80 },
        { start: 80, end: 95 },
    ]
}

/** Weighted percent for a raw 0-100 stream percent, never going backwards. */
export function computeWeightedPercent(
    rawPercent: number,
    streamIndex: number,
    weights: ProgressWeight[],
    maxEmittedPercent: number,
): number {
    const weight = weights[Math.min(streamIndex, weights.length - 1)]
    const mapped =
        weight.start + (rawPercent / 100) * (weight.end - weight.start)
    return Math.max(maxEmittedPercent, mapped)
}
