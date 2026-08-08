import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
    resolve: {
        alias: {
            '#': path.resolve('./src'),
            '@': path.resolve('./src'),
        },
    },
    build: {
        ssr: true,
        lib: {
            entry: 'src/main.ts',
            formats: ['es'],
            fileName: 'main',
        },
        rollupOptions: {
            external: [
                'electron',
                'electron-squirrel-startup',
                'node:child_process',
                'node:fs',
                'node:fs/promises',
                'node:os',
                'node:path',
                'node:stream',
                'node:stream/promises',
                'node:url',
                'node:util',
            ],
        },
    },
})
