import type { ReactNode } from 'react'

import { Download, Loader2, RefreshCw, X } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { ProgressBar } from '#/components/ui/progress'
import { useUpdater } from '#/hooks/use-updater'

export function UpdatePanel() {
    const { state, currentVersion, check, download, install } = useUpdater()
    if (!state) return null

    const isChecking = state.status === 'checking'
    const isAvailable = state.status === 'available'
    const isDownloaded = state.status === 'downloaded'
    const isInstalling = state.status === 'installing'

    // Idle, checking, available, downloaded, and installing share one compact
    // row: a label on the left, a single action button on the right. Checking
    // and installing swap in a disabled spinner; available a primary download
    // button; downloaded a primary restart button.
    if (
        state.status === 'idle' ||
        isChecking ||
        isAvailable ||
        isDownloaded ||
        isInstalling
    ) {
        const label = isAvailable
            ? `Available: ${state.version}`
            : isDownloaded
              ? 'Restart to update'
              : isInstalling
                ? 'Installing update…'
                : currentVersion
                  ? `v${currentVersion}`
                  : ''
        return (
            <div className="border-border flex h-12 items-center justify-between border-t p-2.5">
                <span className="text-muted-foreground text-[11px]">
                    {label}
                </span>
                {isAvailable ? (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void download()}
                        title="Download update"
                        aria-label="Download update"
                        className="px-1.5"
                    >
                        <Download />
                    </Button>
                ) : isDownloaded ? (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void install()}
                        title="Restart to update"
                        aria-label="Restart to update"
                        className="px-1.5"
                    >
                        <RefreshCw />
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void check()}
                        disabled={isChecking || isInstalling}
                        title={
                            isInstalling
                                ? 'Installing update…'
                                : isChecking
                                  ? 'Checking for updates…'
                                  : 'Check for updates'
                        }
                        aria-label={
                            isInstalling
                                ? 'Installing update'
                                : isChecking
                                  ? 'Checking for updates'
                                  : 'Check for updates'
                        }
                        className="px-1.5"
                    >
                        {isChecking || isInstalling ? (
                            <Loader2 className="animate-spin" />
                        ) : (
                            <RefreshCw />
                        )}
                    </Button>
                )}
            </div>
        )
    }

    // Fixed-height section: every state renders inside the same box so the
    // sidebar never jumps when the status changes.
    let content: ReactNode = null
    switch (state.status) {
        case 'downloading':
            content = (
                <div className="flex flex-col gap-1.5">
                    <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                        <span>Downloading...</span>
                        <span className="font-mono">
                            {Math.round(state.percent)}%
                        </span>
                    </div>
                    <ProgressBar value={state.percent / 100} />
                </div>
            )
            break

        case 'error':
            content = (
                <div className="flex flex-col gap-2.5">
                    <div className="flex items-start gap-2">
                        <X className="text-danger mt-0.5 size-4 shrink-0" />
                        <span className="text-muted-foreground min-w-0 text-[11px] leading-snug wrap-break-word">
                            {state.error}
                        </span>
                    </div>
                    <Button
                        variant="default"
                        size="sm"
                        block
                        onClick={() => void check()}
                    >
                        <RefreshCw />
                        Try again
                    </Button>
                </div>
            )
            break

        default:
            content = null
    }

    // min-h-12 keeps the panel compact when content fits; it grows with the
    // content otherwise. No internal scrolling, so no scrollbars in any state.
    return (
        <div className="border-border flex min-h-12 flex-col justify-center border-t p-2.5">
            {content}
        </div>
    )
}
