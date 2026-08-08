import {
    createHashHistory,
    createRouter as createTanStackRouter,
} from '@tanstack/react-router'

import { routeTree } from './routes'

const hashHistory = createHashHistory()

export function getRouter() {
    const router = createTanStackRouter({
        routeTree,
        history: hashHistory,
        scrollRestoration: true,
        defaultPreload: 'intent',
        defaultPreloadStaleTime: 0,
    })

    return router
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof getRouter>
    }
}
