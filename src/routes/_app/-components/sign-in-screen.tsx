import { AppTitlebar } from '#/components/app-titlebar'
import { Loader2, X, Youtube } from '#/components/icons'
import { Button } from '#/components/ui/button'

import appLogo from '../../../../assets/icon.rounded.png'

interface SignInScreenProps {
    checking: boolean
    status: 'idle' | 'opened' | 'signed-in' | 'closed' | 'signed-out'
    /** The Google sign-in URL to load in the embedded webview ('opened'). */
    url?: string | null
    onSignIn: () => void
    onCancel: () => void
    onSkip: () => void
}

/**
 * Full-window gate shown until a YouTube session exists. Sign-in runs in an
 * embedded stock-Chromium <webview> (own persistent partition, no fingerprint
 * tampering) — the same approach the recreate app's browser panel uses, which
 * Google does not block. The main process polls that partition's cookies and
 * reports 'signed-in' the moment a session appears. The downloader UI is not
 * rendered behind the gate, but signing in can be skipped (anonymous
 * downloads + the retry ladder still work when Google allows them).
 */
export function SignInScreen({
    checking,
    status,
    url,
    onSignIn,
    onCancel,
    onSkip,
}: SignInScreenProps) {
    if (url) {
        return (
            <div className="bg-background text-foreground flex h-full w-full flex-col overflow-hidden font-sans select-none">
                <AppTitlebar />

                <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-3">
                    <img
                        src={appLogo}
                        alt=""
                        className="h-5 w-5 rounded-md object-contain"
                    />
                    <div className="min-w-0 flex-1">
                        <p className="text-foreground text-sm font-medium">
                            Sign in to YouTube
                        </p>
                        <p className="text-muted-foreground truncate text-[11px]">
                            FuseGrab picks up your session automatically once
                            you're signed in
                        </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={onCancel}>
                        <X className="h-3.5 w-3.5" />
                        Cancel
                    </Button>
                </div>

                {/* Stock Chromium: no UA or UA-CH tampering — the fingerprint
                    Google accepts. Cookies land in the persist:fusegrab-signin
                    partition, which the main process exports to the yt-dlp
                    cookie jar on session detection. */}
                <webview
                    src={url}
                    partition="persist:fusegrab-signin"
                    webpreferences="contextIsolation=yes,sandbox=yes,nodeIntegration=no"
                    className="min-h-0 flex-1 bg-white"
                />
            </div>
        )
    }

    return (
        <div className="bg-background text-foreground flex h-full w-full flex-col overflow-hidden font-sans select-none">
            <AppTitlebar />

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6">
                <div className="flex flex-col items-center gap-4 text-center">
                    <img
                        src={appLogo}
                        alt="FuseGrab"
                        className="h-16 w-16 rounded-2xl object-contain shadow-sm"
                    />
                    <div className="space-y-1.5">
                        <h1 className="text-foreground text-lg font-semibold">
                            Sign in to YouTube
                        </h1>
                        <p className="text-muted-foreground max-w-72 text-sm">
                            Sign in inside FuseGrab to avoid YouTube's bot
                            checks — your session is picked up automatically.
                        </p>
                    </div>
                </div>

                <div className="flex w-full max-w-72 flex-col items-stretch gap-2">
                    <Button
                        variant="primary"
                        block
                        disabled={checking || status === 'opened'}
                        onClick={onSignIn}
                    >
                        {checking || status === 'opened' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Youtube />
                        )}
                        {checking
                            ? 'Checking sign-in…'
                            : status === 'opened'
                              ? 'Opening sign-in…'
                              : 'Sign in to YouTube'}
                    </Button>

                    <button
                        type="button"
                        onClick={onSkip}
                        className="text-muted-foreground hover:text-foreground cursor-pointer py-1 text-xs underline-offset-4 hover:underline"
                    >
                        Continue without signing in
                    </button>
                </div>
            </div>
        </div>
    )
}
