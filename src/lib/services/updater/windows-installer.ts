import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Spawns the Windows installer with UAC elevation support.
 *
 * The NSIS setup is compiled with `RequestExecutionLevel admin`, so it cannot
 * be launched via `child_process.spawn()` / `CreateProcessW` by an unelevated
 * process: Windows rejects the call with ERROR_ELEVATION_REQUIRED (Win32 error
 * 740), which libuv surfaces as `EACCES`.
 *
 * Launch strategies, tried in order:
 *
 * 1. PowerShell `Start-Process -Verb RunAs` with `/AUTOUPDATE` — requests UAC
 *    elevation explicitly and skips wizard pages for an automated install.
 * 2. `cmd.exe /c start` with `/AUTOUPDATE` — triggers UAC via the NSIS manifest
 *    and passes `/AUTOUPDATE`.
 * 3. `shell.openPath()` — native `ShellExecuteEx` fallback (prompts manual wizard
 *    if script elevation fails).
 *
 * A strategy "reporting success" is not trusted on its own. After each launch
 * attempt we poll the process list for the setup executable and only quit the
 * host app once the installer is verifiably running (this is what shows the
 * same progress window a manual install shows — `/AUTOUPDATE` merely skips
 * its welcome/directory/finish pages). If nothing appears, the app stays open
 * and the failure surfaces as a visible error instead of a silent dead end.
 */

/** How long to wait for the installer process to appear per launch attempt. */
const PROCESS_WAIT_TIMEOUT_MS = 60_000
const PROCESS_POLL_INTERVAL_MS = 500

/** Grace period after a confirmed launch before quitting the host app. */
const QUIT_DELAY_MS = 1500

async function validateInstaller(installerPath: string): Promise<void> {
    let info
    try {
        info = await stat(installerPath)
    } catch {
        throw new Error(
            'The downloaded installer is missing. Try checking for updates again.',
        )
    }
    if (!info.isFile() || info.size === 0) {
        throw new Error(
            'The downloaded installer is incomplete. Try downloading the update again.',
        )
    }
}

/**
 * Resolves once the installer image shows up in the process list; rejects on
 * timeout. Polling by image name (rather than tracking a child PID) is what
 * makes this work for every strategy, including ShellExecuteEx-based ones
 * where the elevated installer isn't our child process at all.
 */
function waitForInstallerProcess(imageName: string): Promise<void> {
    const deadline = Date.now() + PROCESS_WAIT_TIMEOUT_MS

    return new Promise((resolve, reject) => {
        let killTimer: ReturnType<typeof setTimeout> | null = null
        const poll = () => {
            const tasklist = spawn(
                'tasklist.exe',
                ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'],
                { windowsHide: true },
            )
            let stdout = ''
            tasklist.stdout?.on('data', (chunk) => {
                stdout += String(chunk)
            })
            // tasklist occasionally hangs; restart the poll if it does.
            killTimer = setTimeout(() => {
                tasklist.kill()
                poll()
            }, 5000)

            const settle = () => {
                if (killTimer) clearTimeout(killTimer)
            }

            tasklist.once('error', (err) => {
                settle()
                reject(err)
            })
            tasklist.once('exit', (code) => {
                settle()
                if (
                    code === 0 &&
                    stdout.toLowerCase().includes(imageName.toLowerCase())
                ) {
                    resolve()
                    return
                }
                if (Date.now() >= deadline) {
                    reject(
                        new Error(
                            `Installer process (${imageName}) did not start within ${
                                PROCESS_WAIT_TIMEOUT_MS / 1000
                            } seconds.`,
                        ),
                    )
                    return
                }
                setTimeout(poll, PROCESS_POLL_INTERVAL_MS)
            })
        }
        poll()
    })
}

function launchViaShell(installerPath: string): Promise<void> {
    return shell.openPath(installerPath).then((errorMsg) => {
        if (errorMsg) {
            throw new Error(errorMsg)
        }
    })
}

function launchViaPowerShell(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const escapedPath = installerPath.replace(/'/g, "''")
        const child = spawn(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-WindowStyle',
                'Hidden',
                '-Command',
                // Launch installer with /AUTOUPDATE. It runs as user without UAC,
                // and self-elevates in .onInit only if migrating from Program Files.
                `try { Start-Process -FilePath '${escapedPath}' -ArgumentList '/AUTOUPDATE' -ErrorAction Stop } catch { exit 1 }`,
            ],
            {
                windowsHide: true,
                stdio: 'ignore',
            },
        )

        child.once('error', reject)
        child.once('exit', (code) => {
            if (code === 0) {
                resolve()
            } else {
                reject(new Error(`Start-Process failed (exit code ${code}).`))
            }
        })
    })
}

function launchViaCmd(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // cmd.exe start syntax: start "" "path" /AUTOUPDATE
        const child = spawn(
            'cmd.exe',
            ['/c', 'start', '""', `"${installerPath}"`, '/AUTOUPDATE'],
            {
                windowsHide: true,
                stdio: 'ignore',
                shell: true,
            },
        )

        child.once('error', reject)
        child.once('exit', (code) => {
            if (code === 0) {
                resolve()
            } else {
                reject(new Error(`cmd.exe start failed (exit code ${code}).`))
            }
        })
    })
}

export async function installWindowsExe(
    installerPath: string,
): Promise<boolean> {
    await validateInstaller(installerPath)

    const imageName = path.basename(installerPath)
    const strategies: Array<(p: string) => Promise<void>> = [
        launchViaPowerShell,
        launchViaCmd,
        launchViaShell,
    ]
    const failures: string[] = []

    for (const [index, strategy] of strategies.entries()) {
        try {
            await strategy(installerPath)
            await waitForInstallerProcess(imageName)

            console.log(
                `[updater] Installer launched via strategy ${index + 1}; quitting host app.`,
            )

            // Give the installer's window a moment to come up before quitting
            // the host app. Its own taskkill covers any straggler processes
            // either way.
            setTimeout(() => {
                app.quit()
            }, QUIT_DELAY_MS)
            return true
        } catch (err) {
            failures.push(err instanceof Error ? err.message : String(err))
        }
    }

    console.error('[updater] All installer launch attempts failed:', failures)
    // Deliberately do NOT quit: the user keeps their session and sees this in
    // the update panel.
    throw new Error(
        `Couldn't start the installer. If a Windows permission (UAC) prompt appeared, choose Yes and try again. (${failures.join('; ')})`,
    )
}
