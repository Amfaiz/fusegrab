import './styles.css'

import React from 'react'
import ReactDOM from 'react-dom/client'

import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'

import { queryClient } from './lib/query-client'
import { getRouter } from './router'

if (window.windowControls?.platform) {
    document.documentElement.dataset.platform = window.windowControls.platform
}

if (window.windowControls?.platform === 'win32') {
    const setMaximized = (v: boolean) => {
        document.documentElement.dataset.maximized = v ? 'true' : 'false'
    }
    window.windowControls.isMaximized().then(setMaximized)
    window.windowControls.onMaximizedChange(setMaximized)
}

const router = getRouter()

ReactDOM.createRoot(document.getElementById('app')!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    </React.StrictMode>,
)

// Fade out the inline splash (index.html) now that the app has rendered.
// requestAnimationFrame waits for the first commit's paint so we don't reveal
// a half-laid-out frame. The element is removed after the CSS fade completes.
requestAnimationFrame(() => {
    const splash = document.getElementById('splash')
    if (!splash) return
    splash.classList.add('is-hiding')
    splash.addEventListener('transitionend', () => splash.remove(), {
        once: true,
    })
})
