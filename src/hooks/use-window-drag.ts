import { useRef } from 'react'

export function useWindowDrag() {
    const lastPosRef = useRef<{ x: number; y: number } | null>(null)

    const onMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return
        const target = e.target as HTMLElement | null
        if (
            target?.closest(
                'a, button, input, label, select, textarea, [role="button"], [role="slider"], [role="switch"], [role="tab"], [data-no-drag]',
            )
        ) {
            return
        }
        lastPosRef.current = { x: e.screenX, y: e.screenY }

        const handleMove = (ev: MouseEvent) => {
            const last = lastPosRef.current
            if (!last) return
            const dx = ev.screenX - last.x
            const dy = ev.screenY - last.y
            if (dx === 0 && dy === 0) return
            lastPosRef.current = { x: ev.screenX, y: ev.screenY }
            window.windowControls?.moveBy(dx, dy)
        }

        const handleUp = () => {
            lastPosRef.current = null
            document.removeEventListener('mousemove', handleMove)
            document.removeEventListener('mouseup', handleUp)
        }

        document.addEventListener('mousemove', handleMove)
        document.addEventListener('mouseup', handleUp)
    }

    const style = {
        WebkitAppRegion: 'drag',
    } as React.CSSProperties

    return { style, onMouseDown }
}
