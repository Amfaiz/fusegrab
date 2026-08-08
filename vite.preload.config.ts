import { defineConfig, esmExternalRequirePlugin } from 'vite'

export default defineConfig({
    plugins: [
        esmExternalRequirePlugin({
            external: ['electron'],
        }),
    ],
    build: {
        rollupOptions: {
            output: {
                format: 'es',
            },
        },
    },
})
