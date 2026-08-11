import { describe, expect, it } from 'vitest'

import {
    buildStreamWeights,
    computeWeightedPercent,
    createStartPercentGuard,
    isHlsStartGlitch,
    parseStreamCount,
    parseYtDlpPercent,
} from './progress'

describe('parseYtDlpPercent', () => {
    it('parses yt-dlp [download] percent lines', () => {
        expect(
            parseYtDlpPercent(
                '[download]  59.8% of ~ 382.23MiB at      0.00B/s ETA Unknown (frag 153/254)',
            ),
        ).toBe(59.8)
        expect(
            parseYtDlpPercent(
                '[download] 100% of  350.97MiB in 00:01:38 at 3.55MiB/s',
            ),
        ).toBe(100)
        expect(
            parseYtDlpPercent(
                '[download]   0.0% of    10.23MiB at    0.00B/s ETA Unknown',
            ),
        ).toBe(0)
    })

    it('parses aria2 [download] lines', () => {
        expect(parseYtDlpPercent('[#1a2b3c 4/16] 25%')).toBe(25)
        expect(
            parseYtDlpPercent(
                '[download] [aria2c] [#1a2b3c 4/16] 25%(4.0/16.0MiB)',
            ),
        ).toBe(25)
    })

    it('filters the hlsnative placeholder 100% line', () => {
        expect(
            parseYtDlpPercent(
                '[download] 100.0% of ~   1.00KiB at    379.76B/s ETA Unknown (frag 0/190)',
            ),
        ).toBeNull()
    })

    it('returns null for non-progress lines', () => {
        expect(
            parseYtDlpPercent('[download] Destination: /tmp/video.mp4'),
        ).toBeNull()
        expect(
            parseYtDlpPercent('[youtube] Extracting URL: https://youtu.be/x'),
        ).toBeNull()
        expect(
            parseYtDlpPercent(
                '[download] /tmp/video.mp4.part-Frag156 has already been downloaded',
            ),
        ).toBeNull()
        expect(parseYtDlpPercent('')).toBeNull()
    })
})

describe('isHlsStartGlitch', () => {
    it('flags the placeholder 100% line before the first fragment', () => {
        expect(
            isHlsStartGlitch(
                '[download] 100.0% of ~   1.00KiB at    379.76B/s ETA Unknown (frag 0/190)',
            ),
        ).toBe(true)
    })

    it('keeps real early progress and real completion lines', () => {
        expect(
            isHlsStartGlitch(
                '[download]   1.6% of ~ 190.00KiB at    379.76B/s ETA Unknown (frag 0/190)',
            ),
        ).toBe(false)
        expect(
            isHlsStartGlitch(
                '[download] 100.0% of ~ 350.97MiB in 00:01:38 at 3.55MiB/s (frag 190/190)',
            ),
        ).toBe(false)
        expect(
            isHlsStartGlitch(
                '[download] 100% of  218.53KiB in 00:00:00 at 280.81KiB/s',
            ),
        ).toBe(false)
        expect(isHlsStartGlitch('[download] Destination: /tmp/video.mp4')).toBe(
            false,
        )
    })
})

describe('createStartPercentGuard', () => {
    it('rejects near-100% until real progress is seen, then accepts', () => {
        const g = createStartPercentGuard()
        expect(g.accept(100)).toBe(false)
        expect(g.accept(99.8)).toBe(false)
        expect(g.accept(1.6)).toBe(true)
        expect(g.accept(100)).toBe(true)
    })

    it('reset re-arms the guard for the next stream', () => {
        const g = createStartPercentGuard()
        expect(g.accept(50)).toBe(true)
        g.reset()
        expect(g.accept(100)).toBe(false)
    })
})

describe('parseStreamCount', () => {
    it('counts a + pair as two streams even when N is 1', () => {
        expect(
            parseStreamCount(
                '[info] jNQXAC9IVRw: Downloading 1 format(s): 395+251',
            ),
        ).toBe(2)
    })

    it('counts a single combined format as one stream', () => {
        expect(
            parseStreamCount('[info] 7QDwV2-zkVA: Downloading 1 format(s): 96'),
        ).toBe(1)
        expect(
            parseStreamCount('[info] 7QDwV2-zkVA: Downloading 1 format(s): 22'),
        ).toBe(1)
    })

    it('counts parts across + and comma separators', () => {
        expect(
            parseStreamCount(
                '[info] 7QDwV2-zkVA: Downloading 2 format(s): 137+140',
            ),
        ).toBe(2)
        expect(
            parseStreamCount(
                '[info] 7QDwV2-zkVA: Downloading 3 format(s): 137+140+251',
            ),
        ).toBe(3)
        expect(
            parseStreamCount(
                '[info] 7QDwV2-zkVA: Downloading 2 format(s): 137+140, 251',
            ),
        ).toBe(3)
    })

    it('returns null for other lines', () => {
        expect(
            parseStreamCount('[download] Downloading item 1 of 1'),
        ).toBeNull()
        expect(parseStreamCount('[download]  42% of 1MiB')).toBeNull()
        expect(parseStreamCount('')).toBeNull()
    })
})

describe('buildStreamWeights', () => {
    it('gives the whole bar to a single-format download', () => {
        expect(buildStreamWeights(1, false)).toEqual([{ start: 0, end: 100 }])
        expect(buildStreamWeights(1, true)).toEqual([{ start: 0, end: 100 }])
    })

    it('splits video+audio into 0-80 / 80-95', () => {
        expect(buildStreamWeights(2, false)).toEqual([
            { start: 0, end: 80 },
            { start: 80, end: 95 },
        ])
    })
})

describe('computeWeightedPercent', () => {
    it('maps a single stream across the full bar', () => {
        const weights = buildStreamWeights(1, false)
        expect(computeWeightedPercent(0, 0, weights, 0)).toBe(0)
        expect(computeWeightedPercent(80, 0, weights, 0)).toBe(80)
        expect(computeWeightedPercent(100, 0, weights, 0)).toBe(100)
    })

    it('maps two streams onto 0-80 then 80-95', () => {
        const weights = buildStreamWeights(2, false)
        expect(computeWeightedPercent(100, 0, weights, 0)).toBe(80)
        expect(computeWeightedPercent(0, 1, weights, 80)).toBe(80)
        expect(computeWeightedPercent(100, 1, weights, 80)).toBe(95)
    })

    it('never goes backwards', () => {
        const weights = buildStreamWeights(1, false)
        expect(computeWeightedPercent(30, 0, weights, 60)).toBe(60)
        expect(computeWeightedPercent(10, 1, weights, 90)).toBe(90)
    })
})
