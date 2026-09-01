import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, loadTheme, saveTheme, THEME_STORAGE_KEY } from './theme'

describe('Theme management', () => {
    let mockStore: Record<string, string>
    let classListSet: Set<string>

    beforeEach(() => {
        mockStore = {}
        classListSet = new Set<string>()

        // Mock localStorage
        const mockLocalStorage = {
            getItem: (key: string) => mockStore[key] ?? null,
            setItem: (key: string, value: string) => {
                mockStore[key] = value
            },
            removeItem: (key: string) => {
                delete mockStore[key]
            },
            clear: () => {
                mockStore = {}
            },
        }

        // Mock document.documentElement.classList
        const mockClassList = {
            add: (...tokens: string[]) => {
                tokens.forEach((t) => classListSet.add(t))
            },
            remove: (...tokens: string[]) => {
                tokens.forEach((t) => classListSet.delete(t))
            },
            contains: (token: string) => classListSet.has(token),
        }

        vi.stubGlobal('localStorage', mockLocalStorage)
        vi.stubGlobal('document', {
            documentElement: {
                classList: mockClassList,
            },
        })
        vi.stubGlobal('window', {
            matchMedia: vi.fn().mockImplementation((query: string) => ({
                matches: query === '(prefers-color-scheme: dark)',
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            })),
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('defaults to system when nothing is saved', () => {
        expect(loadTheme()).toBe('system')
    })

    it('loads saved theme from localStorage', () => {
        mockStore[THEME_STORAGE_KEY] = 'dark'
        expect(loadTheme()).toBe('dark')

        mockStore[THEME_STORAGE_KEY] = 'light'
        expect(loadTheme()).toBe('light')
    })

    it('persists theme using saveTheme', () => {
        saveTheme('dark')
        expect(mockStore[THEME_STORAGE_KEY]).toBe('dark')
        expect(loadTheme()).toBe('dark')
        expect(classListSet.has('dark')).toBe(true)
        expect(classListSet.has('light')).toBe(false)

        saveTheme('light')
        expect(mockStore[THEME_STORAGE_KEY]).toBe('light')
        expect(loadTheme()).toBe('light')
        expect(classListSet.has('light')).toBe(true)
        expect(classListSet.has('dark')).toBe(false)
    })

    it('applies dark theme correctly', () => {
        applyTheme('dark')
        expect(classListSet.has('dark')).toBe(true)
        expect(classListSet.has('light')).toBe(false)
    })

    it('applies light theme correctly', () => {
        applyTheme('light')
        expect(classListSet.has('light')).toBe(true)
        expect(classListSet.has('dark')).toBe(false)
    })

    it('applies system theme matching media query', () => {
        applyTheme('system')
        expect(classListSet.has('dark')).toBe(true)
        expect(classListSet.has('light')).toBe(false)
    })
})
