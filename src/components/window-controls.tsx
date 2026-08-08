import { useEffect, useState } from 'react'

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

const buttonClass =
    'flex h-10 w-[46px] items-center justify-center text-foreground/70 transition-colors duration-150 hover:bg-black/[0.06] hover:text-foreground active:bg-black/[0.10]'

const closeButtonClass =
    'flex h-10 w-[46px] items-center justify-center text-foreground/70 transition-colors duration-150 hover:bg-[#e81123] hover:text-white active:bg-[#c50f1f]'

export function WindowControls() {
    const [mounted, setMounted] = useState(false)
    const [maximized, setMaximized] = useState(false)

    useEffect(() => {
        setMounted(true)
        if (window.windowControls?.platform !== 'win32') return

        let active = true
        window.windowControls.isMaximized().then((v) => {
            if (active) setMaximized(v)
        })
        const off = window.windowControls.onMaximizedChange(setMaximized)
        return () => {
            active = false
            off()
        }
    }, [])

    if (!mounted) return null
    if (window.windowControls?.platform !== 'win32') return null

    return (
        <div
            className="fixed top-0 right-0 z-30 flex h-10 items-stretch"
            style={noDrag}
        >
            <button
                type="button"
                aria-label="Minimize"
                onClick={() => window.windowControls.minimize()}
                className={buttonClass}
            >
                <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    aria-hidden
                    className="overflow-visible"
                >
                    <path
                        d="M0 5 H10"
                        stroke="currentColor"
                        strokeWidth="1"
                        fill="none"
                    />
                </svg>
            </button>

            <button
                type="button"
                aria-label={maximized ? 'Restore' : 'Maximize'}
                onClick={() => window.windowControls.toggleMaximize()}
                className={buttonClass}
            >
                {maximized ? (
                    <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        aria-hidden
                        className="overflow-visible"
                    >
                        <path
                            d="M2.5 0.5 H9.5 V7.5 M0.5 2.5 H7.5 V9.5 H0.5 Z"
                            stroke="currentColor"
                            strokeWidth="1"
                            fill="none"
                        />
                    </svg>
                ) : (
                    <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        aria-hidden
                        className="overflow-visible"
                    >
                        <rect
                            x="0.5"
                            y="0.5"
                            width="9"
                            height="9"
                            stroke="currentColor"
                            strokeWidth="1"
                            fill="none"
                        />
                    </svg>
                )}
            </button>

            <button
                type="button"
                aria-label="Close"
                onClick={() => window.windowControls.close()}
                className={closeButtonClass}
            >
                <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    aria-hidden
                    className="overflow-visible"
                >
                    <path
                        d="M0 0 L10 10 M10 0 L0 10"
                        stroke="currentColor"
                        strokeWidth="1"
                        fill="none"
                    />
                </svg>
            </button>
        </div>
    )
}
