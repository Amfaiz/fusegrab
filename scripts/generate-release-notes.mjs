// Generates GitHub release notes from git history for the current
// package.json version: commits since the previous `v*` tag (falling back to
// the full history when no previous tag exists), grouped by conventional
// commit prefix into Features / Fixes / etc.
//
// Usage:
//   node scripts/generate-release-notes.mjs            # write out/RELEASE_NOTES.md
//   node scripts/generate-release-notes.mjs --stdout   # print only, no file write

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_FILE = join(ROOT, 'out', 'RELEASE_NOTES.md')

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = String(pkg.version)
const tag = `v${version}`

function git(args) {
    const res = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    if (res.error || res.status !== 0) {
        const detail = (res.error ?? res.stderr ?? '').toString().trim()
        console.error(`[notes] git ${args.join(' ')} failed: ${detail}`)
        process.exit(1)
    }
    return res.stdout
}

const GROUPS = [
    { prefixes: ['feat'], title: 'Features' },
    { prefixes: ['fix'], title: 'Fixes' },
    { prefixes: ['perf'], title: 'Performance' },
    { prefixes: ['refactor'], title: 'Refactoring' },
    { prefixes: ['docs'], title: 'Documentation' },
    { prefixes: ['test'], title: 'Tests' },
    { prefixes: ['build', 'ci'], title: 'Build & CI' },
]
const ALL_PREFIXES = [
    'feat',
    'fix',
    'perf',
    'refactor',
    'docs',
    'test',
    'build',
    'ci',
    'chore',
    'style',
]
const PREFIX_RE = new RegExp(
    `^(${ALL_PREFIXES.join('|')})(\\([^)]*\\))?:\\s*`,
)

// Previous release: highest `v*` tag that isn't the current one.
const prevTag = git(['tag', '--list', 'v*', '--sort=-v:refname'])
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .find((t) => t !== tag)

const range = prevTag ? `${prevTag}..HEAD` : 'HEAD'
const commits = git(['log', '--pretty=format:%s', range])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

function formatSubject(subject) {
    const stripped = subject.replace(PREFIX_RE, '').trim()
    const text = stripped || subject
    return text.charAt(0).toUpperCase() + text.slice(1)
}

const sections = new Map(GROUPS.map((g) => [g.title, []]))
const other = []
let sawConventional = false

for (const commit of commits) {
    const match = commit.match(PREFIX_RE)
    if (match) {
        sawConventional = true
        const group = GROUPS.find((g) => g.prefixes.includes(match[1]))
        if (group) sections.get(group.title).push(formatSubject(commit))
        else other.push(formatSubject(commit))
    } else {
        other.push(commit)
    }
}

const lines = ['## What\'s new', '']

if (commits.length === 0) {
    lines.push(
        prevTag
            ? `No commits since the previous release (${prevTag}).`
            : 'No commits in the repository yet.',
    )
} else {
    if (!prevTag) {
        lines.push('No previous release tag found — listing the full commit history.', '')
    }
    if (!sawConventional) {
        lines.push('### Changes')
        for (const item of other) lines.push(`- ${item}`)
    } else {
        for (const [title, items] of sections) {
            if (items.length === 0) continue
            lines.push(`### ${title}`)
            for (const item of items) lines.push(`- ${item}`)
            lines.push('')
        }
        if (other.length > 0) {
            lines.push('### Other')
            for (const item of other) lines.push(`- ${item}`)
            lines.push('')
        }
    }

    if (prevTag) {
        const origin = git(['config', '--get', 'remote.origin.url']).trim()
        const m = origin.match(/^(?:https?:\/\/|git@)([^/:]+)[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
        if (m) {
            lines.push(
                `[Compare ${prevTag} → ${tag}](https://${m[1]}/${m[2]}/compare/${prevTag}...${tag})`,
            )
        }
    }
}

const notes = lines.join('\n').trimEnd() + '\n'

if (process.argv.includes('--stdout')) {
    process.stdout.write(notes)
} else {
    mkdirSync(dirname(OUT_FILE), { recursive: true })
    writeFileSync(OUT_FILE, notes)
    console.log(notes)
    console.log(`[notes] wrote ${OUT_FILE.replace(ROOT + '/', '')}`)
}
