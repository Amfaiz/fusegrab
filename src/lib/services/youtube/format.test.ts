import { describe, expect, it } from 'vitest'

import { buildVideoFormatSelector } from './format'

describe('buildVideoFormatSelector', () => {
    it('prefers best separate video and audio before compatibility fallbacks', () => {
        const selector = buildVideoFormatSelector()

        expect(selector.split('/')).toEqual([
            'bestvideo+bestaudio',
            'bestvideo[ext=mp4]+bestaudio[ext=m4a]',
            'best',
        ])
    })

    it('applies height limits to every video branch', () => {
        expect(buildVideoFormatSelector(1080).split('/')).toEqual([
            'bestvideo[height<=1080]+bestaudio',
            'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]',
            'best[height<=1080]',
            'best',
        ])
    })
})
