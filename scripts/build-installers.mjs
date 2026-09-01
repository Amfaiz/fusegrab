// Builds installers for macOS (arm64 & x64), Windows ARM64, and Windows 11 (x64).
//
// Usage:
//   node scripts/build-installers.mjs [target]
//   Targets: mac, win-arm, win-x64, win, all (default: all)

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const target = process.argv[2] ?? 'all'

console.log(`[build-installers] Target: ${target}`)
console.log(`[build-installers] Host OS: ${process.platform} (${process.arch})`)

// Electron Forge's @electron/packager uses extract-zip, which has a known hang on
// Node 26 due to yauzl stream handling changes. Require Node 22 or earlier.
const nodeVersion = parseInt(process.version.split('.')[0].slice(1), 10)
if (nodeVersion >= 26) {
    console.error(`[build-installers] ERROR: Node ${process.version} detected.`)
    console.error(
        `[build-installers] Electron Forge packaging hangs on Node 26+ due to extract-zip compatibility.`,
    )
    console.error(`[build-installers] Switch to Node 22 LTS:`)
    console.error(`[build-installers]   nvm use 22`)
    console.error(`[build-installers]   pnpm run make:mac`)
    process.exit(1)
}

// Invoke the forge and make-nsis entry points with the current Node binary
// rather than going through the `pnpm` shim. Since the fix for CVE-2024-27980,
// Node refuses to spawn a .cmd/.bat file without `shell: true` and fails with
// EINVAL (surfacing as a null exit code and no output). Calling the JS entry
// directly sidesteps both that and the arg-escaping hazard of a shell.
const FORGE_BIN = join(
    ROOT,
    'node_modules',
    '@electron-forge',
    'cli',
    'dist',
    'electron-forge.js',
)

function runForgeMake(platform, arch) {
    console.log(`\n==================================================`)
    console.log(`[build-installers] Building for ${platform} (${arch})...`)
    console.log(`==================================================\n`)
    // Pass --require as a real argv flag rather than through NODE_OPTIONS.
    // Node parses NODE_OPTIONS with shell-like quoting, which eats the
    // backslashes in a Windows path ("C:\Users\..." arrives as "C:Users..."
    // and the preload fails to resolve). As a bonus this scopes the preload to
    // the forge process alone instead of every descendant Node process.
    const keepAlivePath = join(ROOT, 'scripts', 'keep-alive.cjs')
    const extraPaths =
        process.platform === 'win32'
            ? ''
            : ':/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin'

    const result = spawnSync(
        process.execPath,
        [
            '--require',
            keepAlivePath,
            FORGE_BIN,
            'make',
            '--platform',
            platform,
            '--arch',
            arch,
        ],
        {
            cwd: ROOT,
            stdio: 'inherit',
            env: {
                ...process.env,
                ELECTRON_GET_SKIP_SUMMARY: '1',
                PATH: `${process.env.PATH ?? ''}${extraPaths}`,
            },
        },
    )
    if (result.error) {
        console.error(
            `[build-installers] Failed to launch forge for ${platform} (${arch}): ${result.error.message}`,
        )
        return false
    }
    if (result.status !== 0) {
        console.error(
            `[build-installers] Failed to build for ${platform} (${arch}) with exit code ${result.status}`,
        )
        return false
    }
    return true
}

function runForgePackage(platform, arch) {
    console.log(`\n==================================================`)
    console.log(`[build-installers] Packaging for ${platform} (${arch})...`)
    console.log(`==================================================\n`)
    const keepAlivePath = join(ROOT, 'scripts', 'keep-alive.cjs')
    const extraPaths =
        process.platform === 'win32'
            ? ''
            : ':/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin'

    const result = spawnSync(
        process.execPath,
        [
            '--require',
            keepAlivePath,
            FORGE_BIN,
            'package',
            '--platform',
            platform,
            '--arch',
            arch,
        ],
        {
            cwd: ROOT,
            stdio: 'inherit',
            env: {
                ...process.env,
                ELECTRON_GET_SKIP_SUMMARY: '1',
                PATH: `${process.env.PATH ?? ''}${extraPaths}`,
            },
        },
    )
    if (result.error) {
        console.error(
            `[build-installers] Failed to launch forge package for ${platform} (${arch}): ${result.error.message}`,
        )
        return false
    }
    if (result.status !== 0) {
        console.error(
            `[build-installers] Failed to package for ${platform} (${arch}) with exit code ${result.status}`,
        )
        return false
    }
    return true
}

// Wraps the already-packaged out/FuseGrab-win32-<arch> in the NSIS wizard
// installer. Calls make-nsis.mjs directly instead of the make:nsis script,
// which would re-run `package` over output forge just built.
function runMakeNsis(arch) {
    const result = spawnSync(
        process.execPath,
        [join(ROOT, 'scripts', 'make-nsis.mjs'), `--arch=${arch}`],
        { cwd: ROOT, stdio: 'inherit' },
    )
    if (result.error) {
        console.error(
            `[build-installers] Error: could not launch NSIS build for ${arch}: ${result.error.message}`,
        )
        return false
    }
    if (result.status !== 0) {
        console.error(
            `[build-installers] Error: NSIS build for ${arch} failed.`,
        )
        return false
    }
    return true
}

function buildWindowsNsis(arch) {
    const packaged = runForgePackage('win32', arch)
    if (!packaged) return false
    if (process.platform === 'win32') {
        return runMakeNsis(arch)
    } else {
        console.warn(
            `[build-installers] Warning: NSIS installer for win32 (${arch}) can only be compiled on a Windows host. App packaged in out/FuseGrab-win32-${arch}.`,
        )
        return true
    }
}

let success = true

if (target === 'mac' || target === 'all') {
    // macOS Apple Silicon (arm64) and Intel (x64)
    if (process.platform === 'darwin') {
        success = runForgeMake('darwin', 'arm64') && success
        success = runForgeMake('darwin', 'x64') && success
    } else {
        console.warn(
            '[build-installers] Warning: macOS DMG/App bundles can only be compiled on macOS host.',
        )
    }
}

if (
    target === 'win-arm' ||
    target === 'nsis-arm' ||
    target === 'win' ||
    target === 'nsis' ||
    target === 'all'
) {
    // Windows ARM64 (NSIS)
    success = buildWindowsNsis('arm64') && success
}

if (
    target === 'win-x64' ||
    target === 'nsis-x64' ||
    target === 'win' ||
    target === 'nsis' ||
    target === 'all'
) {
    // Windows 11 / 10 64-bit (x64) (NSIS)
    success = buildWindowsNsis('x64') && success
}

// Summary of output artifacts
const makeDir = join(ROOT, 'out', 'make')
console.log(`\n==================================================`)
console.log(`[build-installers] Installer artifacts summary:`)
console.log(`==================================================`)

if (existsSync(makeDir)) {
    function getFilesRecursively(dir) {
        let results = []
        const list = readdirSync(dir)
        for (const file of list) {
            const fullPath = join(dir, file)
            const stat = statSync(fullPath)
            if (stat && stat.isDirectory()) {
                results = results.concat(getFilesRecursively(fullPath))
            } else {
                results.push({
                    path: fullPath,
                    sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
                })
            }
        }
        return results
    }

    const files = getFilesRecursively(makeDir)
    if (files.length === 0) {
        console.log('No files found in out/make.')
    } else {
        files.forEach((f) => {
            console.log(`- ${f.path.replace(ROOT + '/', '')} (${f.sizeMB} MB)`)
        })
    }
} else {
    console.log('out/make directory does not exist.')
}

if (!success) {
    process.exit(1)
}
