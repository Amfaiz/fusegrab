import { useEffect } from 'react'

import { createRootRoute, Outlet } from '@tanstack/react-router'

import { WindowControls } from '#/components/window-controls'

export const Route = createRootRoute({
    component: RootLayout,
})

function RootLayout() {
    useEffect(() => {
        const controls = window.windowControls
        if (!controls || controls.platform !== 'win32') return

        let active = true

        const apply = (max: boolean) => {
            if (max) document.documentElement.dataset.maximized = 'true'
            else delete document.documentElement.dataset.maximized
        }

        controls.isMaximized().then((m) => {
            if (active) apply(m)
        })

        const off = controls.onMaximizedChange(apply)

        return () => {
            active = false
            off()
        }
    }, [])

    return (
        <>
            <Outlet />
            <WindowControls />
        </>
    )
}
