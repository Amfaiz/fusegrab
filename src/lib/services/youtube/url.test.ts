import { describe, expect, it } from 'vitest'

import {
    areAllValidYoutubeUrls,
    getInvalidYoutubeUrls,
    isValidYoutubeUrl,
    parseYoutubeUrls,
} from './url'

describe('isValidYoutubeUrl', () => {
    describe('valid URLs', () => {
        it('accepts standard watch URLs', () => {
            expect(
                isValidYoutubeUrl(
                    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                ),
            ).toBe(true)
            expect(
                isValidYoutubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ'),
            ).toBe(true)
            expect(
                isValidYoutubeUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ'),
            ).toBe(true)
            expect(
                isValidYoutubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'),
            ).toBe(true)
            expect(
                isValidYoutubeUrl(
                    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
                ),
            ).toBe(true)
            expect(isValidYoutubeUrl('youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
                true,
            )
            expect(
                isValidYoutubeUrl('www.youtube.com/watch?v=dQw4w9WgXcQ'),
            ).toBe(true)
            expect(
                isValidYoutubeUrl(
                    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&feature=shared',
                ),
            ).toBe(true)
            expect(
                isValidYoutubeUrl(
                    'https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ',
                ),
            ).toBe(true)
        })

        it('accepts shortened youtu.be URLs', () => {
            expect(isValidYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
            expect(isValidYoutubeUrl('http://youtu.be/dQw4w9WgXcQ')).toBe(true)
            expect(isValidYoutubeUrl('youtu.be/dQw4w9WgXcQ')).toBe(true)
            expect(isValidYoutubeUrl('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe(
                true,
            )
            expect(
                isValidYoutubeUrl('https://youtu.be/dQw4w9WgXcQ?si=abcdef123'),
            ).toBe(true)
        })

        it('accepts YouTube Shorts URLs', () => {
            expect(
                isValidYoutubeUrl('https://www.youtube.com/shorts/3jZhwkY4U7I'),
            ).toBe(true)
            expect(
                isValidYoutubeUrl('https://youtube.com/shorts/3jZhwkY4U7I'),
            ).toBe(true)
            expect(isValidYoutubeUrl('youtube.com/shorts/3jZhwkY4U7I')).toBe(
                true,
            )
            expect(
                isValidYoutubeUrl(
                    'https://youtube.com/shorts/3jZhwkY4U7I?feature=share',
                ),
            ).toBe(true)
        })

        it('accepts live streams and embed URLs', () => {
            expect(
                isValidYoutubeUrl('https://www.youtube.com/live/jfKfPfyJRdk'),
            ).toBe(true)
            expect(
                isValidYoutubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'),
            ).toBe(true)
            expect(
                isValidYoutubeUrl('https://www.youtube.com/v/dQw4w9WgXcQ'),
            ).toBe(true)
        })

        it('accepts playlists', () => {
            expect(
                isValidYoutubeUrl(
                    'https://www.youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9f5QQKCSg4N',
                ),
            ).toBe(true)
            expect(
                isValidYoutubeUrl(
                    'youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9f5QQKCSg4N',
                ),
            ).toBe(true)
            expect(
                isValidYoutubeUrl(
                    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOdP_8GztsuKi9f5QQKCSg4N',
                ),
            ).toBe(true)
            expect(
                isValidYoutubeUrl(
                    'https://www.youtube.com/watch?list=PLrAXtmErZgOdP_8GztsuKi9f5QQKCSg4N',
                ),
            ).toBe(true)
        })

        it('accepts channels, handles, and user pages', () => {
            expect(isValidYoutubeUrl('https://www.youtube.com/@mkbhd')).toBe(
                true,
            )
            expect(
                isValidYoutubeUrl('https://www.youtube.com/@mkbhd/videos'),
            ).toBe(true)
            expect(
                isValidYoutubeUrl('https://www.youtube.com/@mkbhd/shorts'),
            ).toBe(true)
            expect(
                isValidYoutubeUrl('https://www.youtube.com/@mkbhd/playlists'),
            ).toBe(true)
            expect(isValidYoutubeUrl('youtube.com/@mkbhd')).toBe(true)
            expect(isValidYoutubeUrl('www.youtube.com/@mkbhd')).toBe(true)
            expect(
                isValidYoutubeUrl(
                    'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ',
                ),
            ).toBe(true)
            expect(
                isValidYoutubeUrl('https://www.youtube.com/c/CreatorName'),
            ).toBe(true)
            expect(
                isValidYoutubeUrl('https://www.youtube.com/user/UserName'),
            ).toBe(true)
        })

        it('handles surrounding whitespace gracefully', () => {
            expect(
                isValidYoutubeUrl(
                    '   https://www.youtube.com/watch?v=dQw4w9WgXcQ   ',
                ),
            ).toBe(true)
        })
    })

    describe('invalid URLs', () => {
        it('rejects empty or whitespace inputs', () => {
            expect(isValidYoutubeUrl('')).toBe(false)
            expect(isValidYoutubeUrl('   ')).toBe(false)
            expect(isValidYoutubeUrl(null)).toBe(false)
            expect(isValidYoutubeUrl(undefined)).toBe(false)
        })

        it('rejects non-YouTube domains', () => {
            expect(isValidYoutubeUrl('https://google.com')).toBe(false)
            expect(isValidYoutubeUrl('https://vimeo.com/123456')).toBe(false)
            expect(
                isValidYoutubeUrl(
                    'https://fakeyoutube.com/watch?v=dQw4w9WgXcQ',
                ),
            ).toBe(false)
        })

        it('rejects bare homepages or non-content paths', () => {
            expect(isValidYoutubeUrl('https://youtube.com')).toBe(false)
            expect(isValidYoutubeUrl('https://youtube.com/')).toBe(false)
            expect(isValidYoutubeUrl('https://www.youtube.com/about')).toBe(
                false,
            )
            expect(isValidYoutubeUrl('https://youtube.com/feed/trending')).toBe(
                false,
            )
        })

        it('rejects incomplete video/playlist parameters', () => {
            expect(isValidYoutubeUrl('https://youtube.com/watch')).toBe(false)
            expect(isValidYoutubeUrl('https://youtube.com/watch?v=')).toBe(
                false,
            )
            expect(isValidYoutubeUrl('https://youtube.com/playlist')).toBe(
                false,
            )
            expect(
                isValidYoutubeUrl('https://youtube.com/playlist?list='),
            ).toBe(false)
            expect(isValidYoutubeUrl('https://youtu.be/')).toBe(false)
            expect(isValidYoutubeUrl('https://youtu.be')).toBe(false)
            expect(isValidYoutubeUrl('https://www.youtube.com/@')).toBe(false)
        })

        it('rejects arbitrary non-URL text', () => {
            expect(isValidYoutubeUrl('hello world')).toBe(false)
            expect(isValidYoutubeUrl('just some text')).toBe(false)
        })
    })
})

describe('parseYoutubeUrls', () => {
    it('splits input by newlines, trims whitespace, and deduplicates', () => {
        const input = `
            https://www.youtube.com/watch?v=dQw4w9WgXcQ
            https://youtu.be/3jZhwkY4U7I
            
            https://www.youtube.com/watch?v=dQw4w9WgXcQ
            https://www.youtube.com/shorts/xyz12345678
        `
        const result = parseYoutubeUrls(input)
        expect(result).toEqual([
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://youtu.be/3jZhwkY4U7I',
            'https://www.youtube.com/shorts/xyz12345678',
        ])
    })

    it('returns empty array for empty or whitespace inputs', () => {
        expect(parseYoutubeUrls('')).toEqual([])
        expect(parseYoutubeUrls('   \n  \n  ')).toEqual([])
        expect(parseYoutubeUrls(null)).toEqual([])
        expect(parseYoutubeUrls(undefined)).toEqual([])
    })
})

describe('areAllValidYoutubeUrls', () => {
    it('returns true when all lines are valid YouTube URLs', () => {
        const input = `
            https://www.youtube.com/watch?v=dQw4w9WgXcQ
            https://youtu.be/3jZhwkY4U7I
            https://www.youtube.com/@mkbhd
        `
        expect(areAllValidYoutubeUrls(input)).toBe(true)
    })

    it('returns false when at least one line is invalid', () => {
        const input = `
            https://www.youtube.com/watch?v=dQw4w9WgXcQ
            https://google.com
            https://youtu.be/3jZhwkY4U7I
        `
        expect(areAllValidYoutubeUrls(input)).toBe(false)
    })

    it('returns false for empty input', () => {
        expect(areAllValidYoutubeUrls('')).toBe(false)
        expect(areAllValidYoutubeUrls('   \n  ')).toBe(false)
    })
})

describe('getInvalidYoutubeUrls', () => {
    it('identifies invalid lines', () => {
        const input = `
            https://www.youtube.com/watch?v=dQw4w9WgXcQ
            https://google.com
            not a valid url
            https://youtu.be/3jZhwkY4U7I
        `
        expect(getInvalidYoutubeUrls(input)).toEqual([
            'https://google.com',
            'not a valid url',
        ])
    })

    it('returns empty array when all lines are valid', () => {
        const input = `
            https://www.youtube.com/watch?v=dQw4w9WgXcQ
            https://youtu.be/3jZhwkY4U7I
        `
        expect(getInvalidYoutubeUrls(input)).toEqual([])
    })
})
