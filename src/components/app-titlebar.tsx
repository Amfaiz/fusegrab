import { useWindowDrag } from '#/hooks/use-window-drag'
import { cn } from '#/lib/utils'

const isMac =
    typeof window !== 'undefined' &&
    (window.windowControls?.platform === 'darwin' ||
        (typeof navigator !== 'undefined' &&
            navigator.userAgent.includes('Mac')))

/**
 * Frameless-window drag region. macOS keeps it invisible (the traffic lights
 * float over content); Windows keeps the titlebar divider under its window
 * controls.
 */
export function AppTitlebar() {
    const dragProps = useWindowDrag()
    return (
        <div
            className={cn(
                'h-10 w-full shrink-0',
                isMac
                    ? 'border-b border-transparent'
                    : 'border-border border-b',
            )}
            {...dragProps}
        />
    )
}
