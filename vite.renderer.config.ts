import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
    resolve: {
        alias: {
            '#': path.resolve('./src'),
            '@': path.resolve('./src'),
        },
    },
    optimizeDeps: {
        // `use-sync-external-store` (pulled in by @tanstack/react-store, itself a
        // dep of react-router) is CommonJS. Its `shim/with-selector` entry is
        // imported as an ESM named export (`useSyncExternalStoreWithSelector`),
        // which only works through Vite's CJS→ESM interop. Force-including it
        // ensures it's pre-bundled with that interop instead of being served raw
        // (which fails with "does not provide an export named …").
        include: [
            'use-sync-external-store/shim',
            'use-sync-external-store/shim/with-selector',
        ],
    },
    plugins: [
        tanstackRouter({
            routesDirectory: './src/routes',
            generatedRouteTree: './src/routes.ts',
            indexToken: 'route',
            routeToken: 'layout',
            // Split each route's component (and its imports) into a lazily
            // loaded chunk. Without this the generated route tree statically
            // imports every route at startup, so the cold first paint has to
            // transform the entire app — including the heavy markdown views —
            // before anything renders. With it, the initial load is just the
            // shell + the matched route.
            autoCodeSplitting: true,
        }),
        viteReact(),
        tailwindcss(),
    ],
})
