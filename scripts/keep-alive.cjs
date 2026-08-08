// Keeps the Node.js event loop alive while async Promises (like @electron/packager
// and the makers) are pending. Without this, forge exits early at "Finalizing
// package" with a misleading exit code 0 and produces no artifacts.
//
// This is injected via NODE_OPTIONS=--require by scripts/build-installers.mjs.
// NODE_OPTIONS is inherited by every descendant Node process, so the interval
// must only be armed in the forge CLI process itself. Forge shells out to short
// helpers like `pnpm config get hoist-pattern`; if one of those inherits a live
// interval it can never exit, and the build deadlocks waiting on it forever.
//
// A `beforeExit` handler cannot fix that: beforeExit only fires once the event
// loop is empty, and the interval is precisely what keeps it non-empty. So gate
// on argv instead and never arm the timer in the helper processes.
const isForgeCli = process.argv.some((arg) => /electron-forge/.test(arg))

if (isForgeCli) {
    const timer = setInterval(() => {}, 1000)

    // Forge's make CLI never calls process.exit(): once api.make() resolves,
    // this interval is the only thing keeping the event loop alive, and the
    // process hangs forever (blocking the next arch in build-installers.mjs).
    // Release the timer the moment forge prints its final completion line so
    // the process exits naturally.
    let finished = false
    const finish = () => {
        if (finished) return
        finished = true
        clearInterval(timer)
        process.stdout.write = origStdout
        process.stderr.write = origStderr
    }
    const origStdout = process.stdout.write.bind(process.stdout)
    const origStderr = process.stderr.write.bind(process.stderr)
    const watch = (orig, chunk, ...rest) => {
        if (!finished && chunk.toString().includes('Artifacts available at:')) {
            queueMicrotask(finish)
        }
        return orig(chunk, ...rest)
    }
    process.stdout.write = watch.bind(null, origStdout)
    process.stderr.write = watch.bind(null, origStderr)

    // Belt and suspenders: if the process exits some other way, drop the timer.
    process.on('exit', () => clearInterval(timer))
}
