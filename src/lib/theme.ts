import { useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'fusegrab:theme'

let mediaQueryList: MediaQueryList | null = null
let mediaQueryHandler: (() => void) | null = null

export function applyTheme(theme: ThemeMode = 'system') {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const root = document.documentElement

    // Remove previous system listener if any
    if (mediaQueryList && mediaQueryHandler) {
        mediaQueryList.removeEventListener('change', mediaQueryHandler)
        mediaQueryList = null
        mediaQueryHandler = null
    }

    const update = () => {
        const prefersDark =
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-color-scheme: dark)').matches
        const isDark = theme === 'dark' || (theme === 'system' && prefersDark)

        if (isDark) {
            root.classList.add('dark')
            root.classList.remove('light')
        } else {
            root.classList.add('light')
            root.classList.remove('dark')
        }
    }

    update()

    if (theme === 'system' && typeof window.matchMedia === 'function') {
        mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)')
        mediaQueryHandler = () => update()
        mediaQueryList.addEventListener('change', mediaQueryHandler)
    }
}

export function loadTheme(): ThemeMode {
    try {
        if (typeof window === 'undefined') return 'system'
        const fromStore = window.store?.getSync<string>(THEME_STORAGE_KEY)
        if (
            fromStore === 'dark' ||
            fromStore === 'light' ||
            fromStore === 'system'
        ) {
            return fromStore
        }
        const stored = localStorage.getItem(THEME_STORAGE_KEY)
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
            return stored
        }
        return 'system'
    } catch {
        return 'system'
    }
}

export function saveTheme(theme: ThemeMode): void {
    try {
        if (typeof window === 'undefined') return
        localStorage.setItem(THEME_STORAGE_KEY, theme)
        window.store?.set(THEME_STORAGE_KEY, theme)
    } catch (err) {
        console.error('Failed to persist theme:', err)
    }
    applyTheme(theme)
}

export function useTheme() {
    const [theme, setThemeState] = useState<ThemeMode>(() => loadTheme())

    const setTheme = (next: ThemeMode) => {
        setThemeState(next)
        saveTheme(next)
    }

    useEffect(() => {
        applyTheme(theme)
    }, [theme])

    return { theme, setTheme }
}
