import { app } from 'electron'
import { spawn } from 'node:child_process'
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function updatesDir(): string {
    return path.join(app.getPath('temp'), 'fusegrab-updates')
}

export function clampPercent(percent: number): number {
    return Math.max(0, Math.min(100, percent))
}

export function currentAppBundlePath(): string | null {
    const parts = app.getPath('exe').split(path.sep)
    const appIndex = parts.findIndex((part) =>
        part.toLowerCase().endsWith('.app'),
    )
    if (appIndex === -1) return null
    return parts.slice(0, appIndex + 1).join(path.sep) || path.sep
}

export function runProcess(
    command: string,
    args: string[],
    failureMessage: string,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'ignore', 'pipe'],
        })
        let stderr = ''
        child.stderr?.on('data', (chunk) => {
            stderr += String(chunk)
        })
        child.once('error', reject)
        child.once('exit', (code) => {
            if (code === 0) {
                resolve()
                return
            }
            reject(
                new Error(
                    `${failureMessage}: ${
                        stderr.trim() || `${command} exited with code ${code}`
                    }`,
                ),
            )
        })
    })
}

export function runProcessOutput(
    command: string,
    args: string[],
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        let stderr = ''
        child.stdout?.on('data', (chunk) => {
            stdout += String(chunk)
        })
        child.stderr?.on('data', (chunk) => {
            stderr += String(chunk)
        })
        child.once('error', reject)
        child.once('exit', (code) => {
            if (code === 0) {
                resolve(stdout)
                return
            }
            reject(
                new Error(
                    stderr.trim() || `${command} exited with code ${code}`,
                ),
            )
        })
    })
}

export async function directorySizeKb(target: string): Promise<number> {
    const output = await runProcessOutput('/usr/bin/du', ['-sk', target])
    const kb = Number(output.trim().split(/\s+/)[0])
    return Number.isFinite(kb) ? kb : 0
}

export async function findMountedAppBundle(mountPath: string): Promise<string> {
    const entries = await readdir(mountPath, { withFileTypes: true })
    const appBundle = entries.find(
        (entry) =>
            entry.isDirectory() && entry.name.toLowerCase().endsWith('.app'),
    )
    if (!appBundle) {
        throw new Error("The update DMG didn't contain a macOS app.")
    }
    return path.join(mountPath, appBundle.name)
}

export async function stageMacAppBundle(
    sourceApp: string,
    stagedApp: string,
    onProgress: (percent: number) => void,
    currentPercent: number,
): Promise<void> {
    await rm(stagedApp, { recursive: true, force: true })
    const totalKb = await directorySizeKb(sourceApp).catch(() => 0)
    let polling = false
    const timer =
        totalKb > 0
            ? setInterval(() => {
                  if (polling) return
                  polling = true
                  directorySizeKb(stagedApp)
                      .then((copiedKb) => {
                          const copyPercent = (copiedKb / totalKb) * 60
                          onProgress(Math.max(currentPercent, 20 + copyPercent))
                      })
                      .catch(() => undefined)
                      .finally(() => {
                          polling = false
                      })
              }, 500)
            : null

    try {
        await runProcess(
            '/usr/bin/ditto',
            [sourceApp, stagedApp],
            "Couldn't stage the update",
        )
    } finally {
        if (timer) clearInterval(timer)
    }
    onProgress(85)
}

export async function detachDmg(mountPath: string): Promise<void> {
    await runProcess(
        '/usr/bin/hdiutil',
        ['detach', mountPath, '-quiet'],
        "Couldn't detach the update image",
    ).catch(() =>
        runProcess(
            '/usr/bin/hdiutil',
            ['detach', mountPath, '-force', '-quiet'],
            "Couldn't detach the update image",
        ).catch(() => undefined),
    )
}

export async function writeMacRelaunchScript(): Promise<string> {
    const scriptPath = path.join(updatesDir(), 'finish-macos-update.sh')
    const script = `#!/bin/sh
set -u

APP_PID="$1"
STAGED_APP="$2"
TARGET_APP="$3"
OLD_APP="$TARGET_APP.previous-update"

while kill -0 "$APP_PID" 2>/dev/null; do
  sleep 0.2
done

/usr/bin/xattr -dr com.apple.quarantine "$STAGED_APP" 2>/dev/null || true
/bin/rm -rf "$OLD_APP"

if [ -d "$TARGET_APP" ]; then
  /bin/mv "$TARGET_APP" "$OLD_APP" || exit 1
fi

if /bin/mv "$STAGED_APP" "$TARGET_APP"; then
  /bin/rm -rf "$OLD_APP"
  /usr/bin/open "$TARGET_APP"
  /bin/rm -rf "$(/usr/bin/dirname "$STAGED_APP")"
  exit 0
fi

if [ -d "$OLD_APP" ]; then
  /bin/mv "$OLD_APP" "$TARGET_APP"
fi

/usr/bin/open "$TARGET_APP" 2>/dev/null || true
exit 1
`
    await writeFile(scriptPath, script, { mode: 0o755 })
    await chmod(scriptPath, 0o755)
    return scriptPath
}

export async function installMacDmg(
    downloadedInstaller: string,
    onProgress: (percent: number) => void,
): Promise<boolean> {
    if (!app.isPackaged) {
        throw new Error('Updates can only be installed from a packaged app.')
    }

    const targetApp = currentAppBundlePath()
    if (!targetApp) {
        throw new Error("Couldn't locate the installed app bundle.")
    }

    const macUpdateDir = path.join(updatesDir(), 'macos')
    const mountPath = path.join(macUpdateDir, 'mount')
    const stageDir = path.join(macUpdateDir, 'stage')
    const stagedApp = path.join(stageDir, path.basename(targetApp))
    let mounted = false

    await rm(macUpdateDir, { recursive: true, force: true })
    await mkdir(mountPath, { recursive: true })
    await mkdir(stageDir, { recursive: true })
    onProgress(5)

    try {
        await runProcess(
            '/usr/bin/hdiutil',
            [
                'attach',
                downloadedInstaller,
                '-nobrowse',
                '-readonly',
                '-mountpoint',
                mountPath,
            ],
            "Couldn't mount the update",
        )
        mounted = true
        onProgress(15)

        const sourceApp = await findMountedAppBundle(mountPath)
        await stageMacAppBundle(sourceApp, stagedApp, onProgress, 15)
    } finally {
        if (mounted) {
            await detachDmg(mountPath)
        }
    }

    const scriptPath = await writeMacRelaunchScript()
    onProgress(95)
    const child = spawn(
        '/bin/sh',
        [scriptPath, String(process.pid), stagedApp, targetApp],
        {
            detached: true,
            stdio: 'ignore',
        },
    )
    child.unref()
    app.quit()
    return true
}
