import { QueryClient } from '@tanstack/react-query'

// App-wide TanStack Query client. A single instance lives for the lifetime of
// the renderer so caches survive route remounts (tabs unmount their components
// on every switch). Defaults are tuned for this desktop app: results stay
// "fresh" long enough that revisiting a tab renders instantly without a
// refetch, and there's no window-focus refetch (it just thrashes in Electron).
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5 * 60 * 1000, // 5 min
            gcTime: 30 * 60 * 1000, // keep cached results well past a tab switch
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
})
