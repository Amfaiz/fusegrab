// Publishes the built installer(s) as a GitHub Release on the *public*
// releases repo (separate from this private source repo). The in-app updater
// reads `/releases/latest` from that repo, so a release must be tagged
// `vX.Y.Z`, be published (not a draft), and carry the platform installer
// assets: NSIS Setup .exe on Windows and DMG on macOS.
//
// Usage:
//   pnpm run release            # build the installer, then publish
//   pnpm run publish            # publish whatever is already in out/make
//   node scripts/publish-release.mjs --draft
//   node scripts/publish-release.mjs --notes "Bug fixes and improvements"
//   node scripts/publish-release.mjs --repo owner/other-repo
//
// Requires the GitHub CLI (`gh`) authenticated with push access to the target
// repo: `gh auth login`.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const DEFAULT_REPO = 'ammarrik/fusegrab'

function flag(name) {
    const pref = `--${name}=`
    const eq = process.argv.find((a) => a.startsWith(pref))
    if (eq) return eq.slice(pref.length)
    const idx = process.argv.indexOf(`--${name}`)
    if (idx !== -1) {
        const next = process.argv[idx + 1]
        return next && !next.startsWith('--') ? next : true
    }
    return undefined
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = String(pkg.version)
const tag = `v${version}`

const repo = flag('repo') ?? DEFAULT_REPO
const draft = flag('draft') === true
const prerelease = flag('prerelease') === true
const notes = typeof flag('notes') === 'string' ? flag('notes') : null
const notesFile =
    typeof flag('notes-file') === 'string' ? flag('notes-file') : null

// Locate the installer(s) produced by scripts/make-nsis.mjs / electron-forge.
const makeDir = join(ROOT, 'out', 'make')
if (!existsSync(makeDir)) {
    console.error(
        `[publish] no build output at ${makeDir}\n` +
            `[publish] build the platform installers before publishing`,
    )
    process.exit(1)
}

const assets = readdirSync(makeDir)
    .filter(
        (f) =>
            (/-Setup-.*\.exe$/i.test(f) || /\.dmg$/i.test(f)) &&
            f.includes(version),
    )
    .map((f) => join(makeDir, f))

if (assets.length === 0) {
    console.error(
        `[publish] no installer assets matching version ${version} found in ${makeDir}\n` +
            `[publish] expected something like FuseGrab-Setup-${version}-x64.exe or FuseGrab-${version}-arm64.dmg`,
    )
    process.exit(1)
}

// Ensure gh is available and authenticated.
if (spawnSync('gh', ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.error(
        '[publish] GitHub CLI not found. Install it (https://cli.github.com) and run "gh auth login".',
    )
    process.exit(1)
}
if (spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status !== 0) {
    console.error('[publish] not authenticated. Run "gh auth login" first.')
    process.exit(1)
}

function gh(args) {
    console.log(`[publish] gh ${args.join(' ')}`)
    const res = spawnSync('gh', args, { stdio: 'inherit' })
    if (res.status !== 0) {
        console.error(`[publish] gh exited with code ${res.status}`)
        process.exit(res.status ?? 1)
    }
}

// Does the release already exist on the target repo?
const exists =
    spawnSync('gh', ['release', 'view', tag, '--repo', repo], {
        stdio: 'ignore',
    }).status === 0

console.log(
    `[publish] ${exists ? 'updating' : 'creating'} release ${tag} on ${repo}`,
)
console.log(`[publish] assets:\n  ${assets.join('\n  ')}`)

if (exists) {
    // Re-upload assets, replacing any with the same name.
    gh(['release', 'upload', tag, ...assets, '--clobber', '--repo', repo])
} else {
    const args = [
        'release',
        'create',
        tag,
        ...assets,
        '--repo',
        repo,
        '--title',
        `FuseGrab ${version}`,
    ]
    if (notesFile) args.push('--notes-file', notesFile)
    else args.push('--notes', notes ?? `FuseGrab ${version}`)
    if (draft) args.push('--draft')
    if (prerelease) args.push('--prerelease')
    gh(args)
}

console.log(`[publish] done — ${tag} published to ${repo}`)
