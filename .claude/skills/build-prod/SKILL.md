---
name: build-prod
description: Build production installers for FuseGrab — Windows x64, Windows ARM64 (NSIS setup .exe), and macOS (.dmg). Use when the user wants to build/create/compile production installers, a release build, a setup .exe, or a .dmg, or asks to build for Windows, Windows ARM, or macOS, or wants release notes / a changelog for a release.
---

# Build production installers for FuseGrab

Produces the shippable installers from the repo root (`fusegrab`, an Electron + Vite app):

| Target | Artifact | Buildable on |
| --- | --- | --- |
| Windows x64 | `out/make/FuseGrab-Setup-<version>-x64.exe` | Windows only |
| Windows ARM64 | `out/make/FuseGrab-Setup-<version>-arm64.exe` | Windows only |
| macOS (arm64 + x64) | `out/make/FuseGrab-<version>-<arch>.dmg` | macOS only |

Both Windows arches cross-build from a single Windows host (either arch). macOS **cannot** be
cross-built from Windows — [scripts/build-installers.mjs](scripts/build-installers.mjs) skips the
mac target with a warning when `process.platform !== 'darwin'`. If the user asks for all three on a
Windows machine, build both Windows arches, then say plainly that the `.dmg` needs a Mac.

Do **not** bump the version or publish to GitHub unless the user explicitly asks. Building is the
default; publishing is a separate outward-facing step (see [Publishing](#publishing-only-when-asked)).

## 1. Preflight

Check all three before building — each one has silently wasted a full build cycle before.

**Node must be < 26.** `@electron/packager` uses extract-zip, which hangs on Node 26+. The build
script hard-blocks it, but check first so you don't discover it after a long wait:

```bash
node --version   # need v22–v25; use `nvm use 22` if higher
```

**NSIS must be installed** (Windows only). Without it the packaging succeeds and only the final
`.exe` step fails:

```bash
ls "/c/Program Files (x86)/NSIS/makensis.exe" || winget install --id NSIS.NSIS \
  --accept-source-agreements --accept-package-agreements --disable-interactivity
```

[scripts/make-nsis.mjs](scripts/make-nsis.mjs) resolves `makensis` from PATH, then
`%ProgramFiles(x86)%\NSIS` and `%ProgramFiles%\NSIS`, so a default winget install needs no PATH edit.
Probe by file existence as above rather than running `makensis /VERSION` from Git Bash — Git Bash
rewrites the `/VERSION` flag into a path and you get a misleading
`Can't open script "C:/Program Files/Git/VERSION"` that looks like a broken install.

**`package.json` must keep `description` and `author`.** `@electron-forge/maker-squirrel` passes them
to `electron-winstaller`, which aborts the whole `make` run with `Authors is required. Description is
required.` if either is missing. They are easy to drop when editing the manifest — verify they're
still there.

## 2. Build Windows (x64 + ARM64)

The `win` target does both arches: forge packages each one, then the NSIS wizard is compiled per arch
(gated on that arch packaging successfully).

```bash
node scripts/build-installers.mjs win
```

There is **no** `make:win` npm script — only `make:win-arm`, `make:win-x64`, `make:mac`, and
`make:all`. `pnpm run make:win` fails with `ERR_PNPM_NO_SCRIPT`. Call the script directly, or use
`make:win-arm` / `make:win-x64` for a single arch.

This takes well over 10 minutes for both arches — solid LZMA compression over ~500 MB per arch is the
bulk of it. **Run it in the background** rather than with a foreground timeout, and poll the output
file. First run also downloads ffmpeg per target into `build/ffmpeg-cache/<platform>-<arch>/`
(cached, so later runs skip it).

Forge's own makers (squirrel, zip) run before the NSIS step and write to
`out/make/squirrel.windows/` and `out/make/zip/`. Those are byproducts — **the NSIS
`FuseGrab-Setup-*.exe` is what ships.**

### If the maker step failed but packaging succeeded

A failing squirrel maker aborts `forge make` and skips the NSIS step, even though the unpacked app is
already complete. Don't re-run the whole build: check for the packaged dir and compile NSIS directly
against it (a couple of minutes per arch instead of ten).

```bash
ls out/FuseGrab-win32-arm64 out/FuseGrab-win32-x64   # ~500 MB each when complete
node scripts/make-nsis.mjs --arch=arm64
node scripts/make-nsis.mjs --arch=x64
```

## 3. Build macOS

On a Mac, both arches (Apple Silicon + Intel):

```bash
node scripts/build-installers.mjs mac
```

`electron-forge make` runs every darwin maker, so a `.zip` byproduct appears alongside each `.dmg` —
the **`.dmg`** is the installer. `@electron-forge/maker-dmg` pulls in `appdmg`, which needs the native
modules `fs-xattr` and `macos-alias` compiled; both are set to `true` under `allowBuilds` in
[pnpm-workspace.yaml](pnpm-workspace.yaml), so a clean `pnpm install` handles it. If `make` fails with
a missing `xattr`/`volume` module, rebuild them and retry:

```bash
( cd node_modules/fs-xattr && npx node-gyp rebuild )
( cd node_modules/macos-alias && npx node-gyp rebuild )
```

Both mac arches are safe to build: [scripts/fetch-ffmpeg.mjs](scripts/fetch-ffmpeg.mjs) fetches a
per-target ffmpeg, so an x64 `.dmg` gets the x64 binary.

The build is unsigned and unnotarized — mention this if you write install instructions.

## 4. Verify

Never report success from the build log alone — confirm the files exist, are freshly written, and
carry the right version:

```bash
ls -lh out/make/*.exe out/make/*.dmg 2>/dev/null
```

On Windows, check the embedded metadata too:

```bash
powershell -NoProfile -Command "Get-ChildItem out/make/*.exe | ForEach-Object { \$v = \$_.VersionInfo; '{0}  Product={1} Ver={2}' -f \$_.Name, \$v.ProductName, \$v.ProductVersion }"
```

Expect `Product=FuseGrab` and a `ProductVersion` matching `package.json`. A Windows `.exe` should be
roughly 110–120 MB; far smaller means a truncated or partial package.

Report the artifact paths and sizes, plus anything you skipped and why (e.g. no `.dmg` on a Windows
host). Call out any arch whose artifact you did **not** verify rather than implying a clean sweep.

## 5. Release notes

```bash
node scripts/generate-release-notes.mjs   # or: pnpm run notes
```

Derives the release notes for the current `package.json` version from git history:
commits since the previous `v*` tag, falling back to the full history when no
previous tag exists (e.g. a first release). Commits with conventional-commit
prefixes (`feat:`, `fix:`, `perf:`, …) are grouped into Features / Fixes /
Performance / etc.; unprefixed messages land in "Changes" when nothing is
prefixed, otherwise "Other". A `Compare vPrev → vCur` link is appended when a
previous tag exists and an `origin` remote is configured.

Writes `out/RELEASE_NOTES.md` (gitignored) and prints the result. `--stdout`
prints without writing. **Review and edit the file before publishing** — it is
what users see on GitHub. The generated file is what `publish-release.mjs`
uploads when you don't pass `--notes`/`--notes-file`.

## Known-benign warnings

Don't chase these; they don't affect output.

- `!undef: "MUI_PAGE_CUSTOMFUNCTION_PRE" not defined!` ×3 from
  [build/installer.nsi](build/installer.nsi) — MUI2's page macros consume the define, so the explicit
  `!undef` after each has nothing left to undo.
- `DEP0147 fs.rmdir(recursive)` from inside the squirrel maker.
- pnpm warning that `pnpm.onlyBuiltDependencies` in `package.json` is no longer read — pnpm 11+ reads
  `allowBuilds` in [pnpm-workspace.yaml](pnpm-workspace.yaml), which is where the real allowlist
  lives. The stale `pnpm` block in `package.json` is inert; edit the workspace file instead.

## The installer UX (already implemented)

[build/installer.nsi](build/installer.nsi) is a NSIS + Modern UI 2 wizard — Welcome → Directory
chooser → install page with progress bar → Finish with a "Launch FuseGrab" button, plus Start
Menu/Desktop shortcuts, an uninstaller, and an Add/Remove Programs entry with reported install size.
It elevates to admin, `taskkill`s a running instance before overwriting locked binaries, and launches
the app via `explorer.exe` so it drops back to the user's normal integrity level. A `/AUTOUPDATE`
flag skips the choice pages for the in-app updater while keeping the progress window. It already
matches the "installs like VS Code" shape — don't rebuild it.

## Publishing (only when asked)

`node scripts/publish-release.mjs` creates/updates the `v<version>` GitHub Release on
`Amfaiz/fusegrab`, auto-attaching every `*-Setup-*.exe` and `*.dmg` in `out/make` whose filename
contains the current version. Requires `gh` installed and authed. When creating a release with no
`--notes`/`--notes-file`, it auto-generates notes from git history (see
[Release notes](#5-release-notes)) and uses `out/RELEASE_NOTES.md` as the body. Useful flags:
`--notes-file <path>`, `--notes "text"`, `--draft`, `--prerelease`, `--repo owner/repo`.

The in-app updater reads `/releases/latest`, which skips drafts and prereleases, and only offers an
update when the published version is **higher** than the running one — so bump the version before
building anything you intend to publish.
