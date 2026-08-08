// Builds the traditional Windows installer (.exe) for FuseGrab.
//
// Run `pnpm run package` first (or use `pnpm run make:nsis`, which does it for
// you): that produces the unpacked app under out/FuseGrab-win32-<arch>. This
// script then drives makensis over build/installer.nsi, passing the source
// directory, output path, and version as /D defines, and writes the setup
// wizard to out/make/.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const APPNAME = 'FuseGrab'
const COMPANYNAME = 'FuseGrab'
const EXENAME = 'FuseGrab.exe'

const [major = '0', minor = '0', build = '0'] = String(pkg.version).split('.')

if (process.platform !== 'win32') {
    console.error('[nsis] the Windows installer can only be built on Windows')
    process.exit(1)
}

// Which architecture's packaged output to wrap. Defaults to the host arch, but
// `--arch=x64` (or FUSE_ARCH=x64) lets us build the installer for a
// cross-packaged target (e.g. an x64 build produced on an arm64 machine).
const archArg = process.argv.find((a) => a.startsWith('--arch='))
const arch = archArg
    ? archArg.slice('--arch='.length)
    : (process.env.FUSE_ARCH ?? process.arch)

const sourceDir = join(ROOT, 'out', `FuseGrab-win32-${arch}`)
if (!existsSync(sourceDir)) {
    console.error(
        `[nsis] packaged app not found at ${sourceDir}\n` +
            `[nsis] run "pnpm run package -- --arch=${arch}" first`,
    )
    process.exit(1)
}

const outDir = join(ROOT, 'out', 'make')
mkdirSync(outDir, { recursive: true })
const outFile = join(
    outDir,
    `${APPNAME}-Setup-${major}.${minor}.${build}-${arch}.exe`,
)

const makensis = findMakensis()
const nsi = join(ROOT, 'build', 'installer.nsi')

const args = [
    `/DAPPNAME=${APPNAME}`,
    `/DCOMPANYNAME=${COMPANYNAME}`,
    `/DEXENAME=${EXENAME}`,
    `/DVERSIONMAJOR=${major}`,
    `/DVERSIONMINOR=${minor}`,
    `/DVERSIONBUILD=${build}`,
    `/DSOURCEDIR=${sourceDir}`,
    `/DOUTFILE=${outFile}`,
    nsi,
]

console.log(`[nsis] compiling ${nsi}`)
const result = spawnSync(makensis, args, { stdio: 'inherit' })
if (result.status !== 0) {
    console.error(`[nsis] makensis exited with code ${result.status}`)
    process.exit(result.status ?? 1)
}

console.log(`[nsis] installer written to ${outFile}`)

// Resolves makensis from PATH, falling back to the default NSIS install dirs.
function findMakensis() {
    const candidates = [
        'makensis',
        join(process.env['ProgramFiles(x86)'] ?? '', 'NSIS', 'makensis.exe'),
        join(process.env['ProgramFiles'] ?? '', 'NSIS', 'makensis.exe'),
    ]
    for (const candidate of candidates) {
        const probe = spawnSync(candidate, ['/VERSION'], { stdio: 'ignore' })
        if (probe.status === 0) {
            return candidate
        }
    }
    console.error(
        '[nsis] makensis not found. Install NSIS (e.g. "winget install NSIS.NSIS")',
    )
    process.exit(1)
}
