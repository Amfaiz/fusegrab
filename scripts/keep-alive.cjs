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
    // Release the timer once forge signals it is done, so the process can exit
    // on its own instead of hanging for the caller to kill it.
    process.on('exit', () => clearInterval(timer))
}
