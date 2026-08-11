import { VitePlugin } from '@electron-forge/plugin-vite'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

// @ts-ignore - mjs has no declaration file
import { fetchDeno, getDenoBinaryName } from './scripts/fetch-deno.mjs'
// @ts-ignore - mjs has no declaration file
import { fetchFfmpeg, getBinaryName } from './scripts/fetch-ffmpeg.mjs'

/**
 * Copies a target-specific static ffmpeg into the packaged app's resources dir.
 *
 * ffmpeg must be a real file on disk that the OS can exec, so it cannot live
 * inside app.asar. `buildPath` here is `<staging>/resources/app` — the directory
 * that gets packed into app.asar and then *deleted*. Its parent is the resources
 * dir, which survives packing, so the binary goes there and is read at runtime
 * via `process.resourcesPath` (see resolveFfmpegBinary in
 * src/lib/services/youtube/binary.ts).
 *
 * Deriving the resources dir from `buildPath` rather than hardcoding it keeps
 * this correct on macOS, where the layout is Contents/Resources.
 */
async function bundleFfmpeg(
    buildPath: string,
    platform: string,
    arch: string,
): Promise<void> {
    const resourcesDir = path.resolve(buildPath, '..')
    const ffmpegDir = path.join(resourcesDir, 'ffmpeg')
    await mkdir(ffmpegDir, { recursive: true })

    const cached = await fetchFfmpeg(platform, arch, console.log)
    const dest = path.join(ffmpegDir, getBinaryName(platform))
    await copyFile(cached, dest)
    console.log(`Bundled ffmpeg for ${platform}-${arch}: ${dest}`)
}

async function bundleDeno(
    buildPath: string,
    platform: string,
    arch: string,
): Promise<void> {
    const resourcesDir = path.resolve(buildPath, '..')
    const denoDir = path.join(resourcesDir, 'deno')
    await mkdir(denoDir, { recursive: true })

    const cached = await fetchDeno(platform, arch, console.log)
    const dest = path.join(denoDir, getDenoBinaryName(platform))
    await copyFile(cached, dest)
    console.log(`Bundled deno for ${platform}-${arch}: ${dest}`)
}

const config = {
    packagerConfig: {
        // Product name — capital "R". Drives the macOS .app bundle name, the
        // Finder/Dock label (CFBundleDisplayName), the .dmg name, and the
        // Windows binary (FuseGrab.exe). The npm package name stays lowercase
        // ("fusegrab"); npm requires it. Note: don't set executableName to a
        // different case — @electron/packager derives CFBundleDisplayName from
        // it, so a lowercase executableName makes the macOS label lowercase.
        name: 'FuseGrab',
        // macOS bundle identifier (CFBundleIdentifier). Without this it would
        // default to com.electron.fusegrab. Helper bundles derive from it
        // (com.fusegrab.app.helper, …).
        appBundleId: 'com.fusegrab.app',
        // App bundle icon. Electron Forge appends the platform-appropriate
        // extension (.icns on macOS, .ico on Windows). Generate these from
        // assets/icon.png with `pnpm run generate-icons`.
        icon: './assets/icon',
        asar: {
            // ffmpeg/ffprobe binaries from ffmpeg-static / ffprobe-static must
            // be unpacked from asar so the OS can exec them at runtime.
            unpack: '**/node_modules/{ffmpeg-static/ffmpeg*,ffprobe-static/bin/**}',
        },
        // The rounded PNG is shipped so the runtime window/taskbar icon works
        // in packaged builds (see src/main.ts).
        extraResource: ['./assets/icon.rounded.png'],
        // Codesign the .app with a Developer ID cert and notarize it with
        // Apple's notary service. Credentials come from the environment at
        // build time: APPLE_API_KEY (path to the .p8), APPLE_API_KEY_ID,
        // APPLE_API_ISSUER — see developer.apple.com/account → App Store
        // Connect API keys.
        osxSign: {
            // No `identity`: osx-sign auto-discovers the sole Developer ID
            // Application cert in the login keychain, so no team ID lives in
            // the repo.
            // electron-packager defaults continueOnError to true and silently
            // continues with an unsigned app when signing fails. Fail loudly.
            continueOnError: false,
        },
        osxNotarize: {
            tool: 'notarytool',
            appleApiKey: process.env.APPLE_API_KEY,
            appleApiKeyId: process.env.APPLE_API_KEY_ID,
            appleApiIssuer: process.env.APPLE_API_ISSUER,
        },
        // @electron/packager wraps these hooks in util.promisify, so they must
        // use the callback contract — an async function that never calls back
        // hangs the build.
        afterCopy: [
            (
                buildPath: string,
                _electronVersion: string,
                platform: string,
                arch: string,
                callback: (err?: Error | null) => void,
            ) => {
                Promise.all([
                    bundleFfmpeg(buildPath, platform, arch),
                    bundleDeno(buildPath, platform, arch),
                ]).then(
                    () => callback(),
                    (err) => callback(err),
                )
            },
        ],
        ignore: (file: string) => {
            if (!file) return false
            if (file.startsWith('/.vite')) return false
            if (file === '/node_modules' || file.startsWith('/node_modules/'))
                return false
            if (file === '/package.json') return false
            if (file === '/out' || file.startsWith('/out/')) return true
            if (file === '/src' || file.startsWith('/src/')) return true
            if (file === '/build' || file.startsWith('/build/')) return true
            if (file === '/scripts' || file.startsWith('/scripts/')) return true
            if (file === '/.git' || file.startsWith('/.git/')) return true
            return false
        },
    },
    rebuildConfig: {},
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            platforms: ['win32'],
            config: {
                // Installer + Add/Remove Programs icon on Windows.
                setupIcon: './assets/icon.ico',
            },
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin', 'win32'],
            config: {},
        },
        {
            // macOS drag-to-install disk image. Uses the same .icns as the app
            // bundle for the volume icon. appdmg (pulled in transitively) needs
            // the fs-xattr / macos-alias native modules compiled — they're in
            // pnpm's onlyBuiltDependencies so a fresh install builds them.
            name: '@electron-forge/maker-dmg',
            platforms: ['darwin'],
            config: {
                icon: './assets/icon.icns',
                overwrite: true,
            },
        },
    ],
    plugins: [
        new VitePlugin({
            build: [
                {
                    entry: 'src/main.ts',
                    config: 'vite.main.config.ts',
                },
                {
                    entry: 'src/preload.ts',
                    config: 'vite.preload.config.ts',
                },
            ],
            renderer: [
                {
                    name: 'main_window',
                    config: 'vite.renderer.config.ts',
                },
            ],
        }),
    ],
}

export default config
