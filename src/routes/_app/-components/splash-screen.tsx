import { AppTitlebar } from '#/components/app-titlebar'
import { Loader2 } from '#/components/icons'

/**
 * Shown for a moment while the persisted YouTube session is read. Blank by
 * design, with only a centered spinner: once the check resolves (and a short
 * minimum display time has passed) the app mounts either the sign-in gate or
 * the downloader UI — never a flash of the wrong screen.
 */
export function SplashScreen() {
    return (
        <div className="bg-background text-foreground flex h-full w-full flex-col overflow-hidden font-sans select-none">
            <AppTitlebar />
            <div className="flex min-h-0 flex-1 items-center justify-center">
                <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
        </div>
    )
}
