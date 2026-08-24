import { describe, expect, it } from 'vitest'

import { formatTimeCode, parseTimeCode, sanitizeFilename } from './types'

describe('types helper functions', () => {
    describe('formatTimeCode', () => {
        it('formats MM:SS correctly', () => {
            expect(formatTimeCode(0)).toBe('00:00')
            expect(formatTimeCode(59)).toBe('00:59')
            expect(formatTimeCode(60)).toBe('01:00')
            expect(formatTimeCode(125)).toBe('02:05')
        })

        it('formats HH:MM:SS when hours > 0 or forced', () => {
            expect(formatTimeCode(3600)).toBe('01:00:00')
            expect(formatTimeCode(3665)).toBe('01:01:05')
            expect(formatTimeCode(125, true)).toBe('00:02:05')
        })

        it('handles negative or invalid values gracefully', () => {
            expect(formatTimeCode(-10)).toBe('00:00')
            expect(formatTimeCode(NaN)).toBe('00:00')
        })
    })

    describe('parseTimeCode', () => {
        it('parses seconds string', () => {
            expect(parseTimeCode('45')).toBe(45)
            expect(parseTimeCode('0')).toBe(0)
        })

        it('parses MM:SS string', () => {
            expect(parseTimeCode('01:30')).toBe(90)
            expect(parseTimeCode('10:05')).toBe(605)
            expect(parseTimeCode('00:00')).toBe(0)
        })

        it('parses HH:MM:SS string', () => {
            expect(parseTimeCode('01:02:03')).toBe(3723)
            expect(parseTimeCode('00:01:30')).toBe(90)
        })

        it('handles dot separators', () => {
            expect(parseTimeCode('01.30')).toBe(90)
            expect(parseTimeCode('01.02.03')).toBe(3723)
        })

        it('returns null for invalid inputs', () => {
            expect(parseTimeCode('')).toBeNull()
            expect(parseTimeCode('abc')).toBeNull()
            expect(parseTimeCode('01:99')).toBeNull()
            expect(parseTimeCode('-5')).toBeNull()
        })
    })

    describe('sanitizeFilename', () => {
        it('sanitizes invalid chars', () => {
            expect(sanitizeFilename('my/video:name?')).toBe('myvideoname')
        })
    })
})
