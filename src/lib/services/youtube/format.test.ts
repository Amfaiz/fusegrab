import { describe, expect, it } from 'vitest'

import { buildVideoFormatSelector } from './format'

describe('buildVideoFormatSelector', () => {
    it('prefers compatible AAC audio (m4a) and MP4 video before generic bestaudio', () => {
        const selector = buildVideoFormatSelector()

        expect(selector.split('/')).toEqual([
            'bestvideo[ext=mp4]+bestaudio[ext=m4a]',
            'bestvideo+bestaudio[ext=m4a]',
            'bestvideo+bestaudio',
            'best',
        ])
    })

    it('applies height limits to every video branch', () => {
        expect(buildVideoFormatSelector(1080).split('/')).toEqual([
            'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]',
            'bestvideo[height<=1080]+bestaudio[ext=m4a]',
            'bestvideo[height<=1080]+bestaudio',
            'best[height<=1080]',
            'best',
        ])
    })

    it('restricts to progressive formats when canMerge is false', () => {
        expect(buildVideoFormatSelector(1080, false).split('/')).toEqual([
            'best[height<=1080]',
            'best',
        ])
    })
})
