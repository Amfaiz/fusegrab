import type { DownloadItem } from './types'

import { useState } from 'react'

import {
    Folder,
    FolderOpen,
    Globe,
    Logout,
    UserCircle,
    Video,
    Whatsapp,
    Youtube,
} from '#/components/icons'
import {
    Menu,
    MenuContent,
    MenuItem,
    MenuSeparator,
    MenuTrigger,
} from '#/components/ui/menu'

import amfaizIcon from '../../../../assets/amfaiz-icon.png'

import { UpdatePanel } from './update-panel'

interface AccountInfo {
    name: string
    avatarUrl: string | null
    email: string | null
}

interface DownloaderSidebarProps {
    items: DownloadItem[]
    activeFilter: string
    setActiveFilter: (filter: string) => void
    onSignIn: () => void
    onSignOut: () => void
    signedIn: boolean
    accountInfo: AccountInfo | null
}

interface AccountSectionProps {
    onSignIn: () => void
    onSignOut: () => void
    signedIn: boolean
    accountInfo: AccountInfo | null
}

/**
 * Google avatar that falls back to the anonymous icon when the image is
 * missing or fails to load. Remount with a `key` to reset the failed state
 * when the avatar URL changes.
 */
function Avatar({
    src,
    imgClassName,
    iconClassName,
}: {
    src: string | null
    imgClassName: string
    iconClassName: string
}) {
    const [failed, setFailed] = useState(false)

    if (!src || failed) {
        return <UserCircle className={iconClassName} />
    }

    return (
        <img
            src={src}
            alt=""
            className={imgClassName}
            onError={() => setFailed(true)}
        />
    )
}

/**
 * A single compact sign-in row. Anonymous shows a "Sign in to YouTube"
 * button; signed in, it becomes an account button (avatar + name) opening a
 * dropdown with the account details, a switch-account item, and Log out.
 */
function AccountSection({
    onSignIn,
    onSignOut,
    signedIn,
    accountInfo,
}: AccountSectionProps) {
    if (!signedIn) {
        return (
            <button
                type="button"
                onClick={onSignIn}
                className="text-foreground/80 hover:bg-muted hover:text-foreground flex w-full items-center gap-1.5 rounded-md p-1.75 text-xs transition-colors"
            >
                <Youtube className="text-muted-foreground size-3.5 shrink-0" />
                <span className="truncate">Sign in to YouTube</span>
            </button>
        )
    }

    return (
        <Menu>
            <MenuTrigger className="hover:bg-muted text-foreground/80 hover:text-foreground flex w-full items-center gap-1.5 rounded-md p-1.75 text-xs transition-colors outline-none">
                <Avatar
                    key={accountInfo?.avatarUrl}
                    src={accountInfo?.avatarUrl ?? null}
                    imgClassName="size-4 shrink-0 rounded-full"
                    iconClassName="text-primary size-3.5 shrink-0"
                />
                <span className="truncate">
                    {accountInfo?.name || 'Anonymous'}
                </span>
            </MenuTrigger>
            <MenuContent sideOffset={4} align="start" className="w-52">
                {accountInfo && (
                    <>
                        <div className="flex items-center gap-2.5 px-2.5 py-2">
                            <Avatar
                                key={accountInfo.avatarUrl}
                                src={accountInfo.avatarUrl}
                                imgClassName="size-8 shrink-0 rounded-full"
                                iconClassName="text-primary size-8 shrink-0"
                            />
                            <div className="min-w-0">
                                <p className="truncate text-xs font-medium">
                                    {accountInfo.name}
                                </p>
                                {accountInfo.email && (
                                    <p className="text-muted-foreground truncate text-[10px]">
                                        {accountInfo.email}
                                    </p>
                                )}
                            </div>
                        </div>
                        <MenuSeparator />
                    </>
                )}
                <MenuItem
                    onClick={onSignOut}
                    className="text-danger hover:bg-danger/10 focus:bg-danger/10"
                >
                    <Logout className="size-3.5" />
                    <span>Log out</span>
                </MenuItem>
            </MenuContent>
        </Menu>
    )
}

export function DownloaderSidebar({
    items,
    activeFilter,
    setActiveFilter,
    onSignIn,
    onSignOut,
    signedIn,
    accountInfo,
}: DownloaderSidebarProps) {
    const [isChannelsOpen, setIsChannelsOpen] = useState(true)

    const individualCount = items.filter((i) => i.isSingleUrl).length

    const channelMap = new Map<string, number>()
    for (const item of items) {
        if (!item.isSingleUrl) {
            const name = item.channelName || 'Uncategorized'
            channelMap.set(name, (channelMap.get(name) || 0) + 1)
        }
    }
    const channelList = Array.from(channelMap.entries()).map(
        ([name, count]) => ({
            name,
            count,
        }),
    )

    return (
        <aside className="border-border bg-surface flex w-56 shrink-0 flex-col justify-between border-r pt-1.5 pr-0 select-none">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2 pl-2">
                <div>
                    <div className="bg-surface text-muted-foreground sticky top-0 z-10 px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-wider uppercase">
                        Categories
                    </div>

                    <div className="flex flex-col gap-1">
                        <button
                            type="button"
                            onClick={() => setActiveFilter('all')}
                            className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                                activeFilter === 'all'
                                    ? 'bg-accent text-foreground'
                                    : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                            }`}
                        >
                            <div className="flex min-w-0 items-center gap-2.5">
                                <Folder className="text-primary h-4 w-4 shrink-0" />
                                <span className="truncate">All Downloads</span>
                            </div>
                            <span className="bg-muted text-muted-foreground ml-1.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                {items.length}
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveFilter('individual')}
                            className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                                activeFilter === 'individual'
                                    ? 'bg-accent text-foreground'
                                    : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                            }`}
                        >
                            <div className="flex min-w-0 items-center gap-2.5">
                                <Video className="text-primary h-4 w-4 shrink-0" />
                                <span className="truncate">
                                    Individual Videos
                                </span>
                            </div>
                            <span className="bg-muted text-muted-foreground ml-1.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                {individualCount}
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsChannelsOpen((prev) => !prev)}
                            className="text-foreground/80 hover:bg-muted hover:text-foreground flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition-colors"
                        >
                            <div className="flex min-w-0 items-center gap-2.5">
                                {isChannelsOpen ? (
                                    <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                                ) : (
                                    <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                                )}
                                <span className="truncate">
                                    Channels & Playlists
                                </span>
                            </div>
                            <span className="bg-muted text-muted-foreground ml-1.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                {channelList.length}
                            </span>
                        </button>

                        {isChannelsOpen && (
                            <div className="flex flex-col gap-1">
                                {channelList.length === 0 ? (
                                    <div className="text-muted-foreground/60 py-1.5 pr-2.5 pl-9 text-[11px] italic">
                                        No channels or playlists
                                    </div>
                                ) : (
                                    channelList.map((ch) => {
                                        const filterKey = `channel:${ch.name}`
                                        const isActive =
                                            activeFilter === filterKey
                                        return (
                                            <button
                                                key={ch.name}
                                                type="button"
                                                onClick={() =>
                                                    setActiveFilter(filterKey)
                                                }
                                                className={`flex w-full items-center justify-between rounded-lg py-2 pr-2.5 pl-9 text-xs font-medium transition-colors ${
                                                    isActive
                                                        ? 'bg-accent text-foreground'
                                                        : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                                                }`}
                                                title={ch.name}
                                            >
                                                <span className="truncate">
                                                    {ch.name}
                                                </span>
                                                <span className="bg-muted text-muted-foreground ml-1.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                                    {ch.count}
                                                </span>
                                            </button>
                                        )
                                    })
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <UpdatePanel />

            <div className="border-border flex w-full items-center gap-1 border-t p-2">
                <div className="min-w-0 flex-1">
                    <AccountSection
                        onSignIn={onSignIn}
                        onSignOut={onSignOut}
                        signedIn={signedIn}
                        accountInfo={accountInfo}
                    />
                </div>
                <Menu>
                    <MenuTrigger
                        aria-label="Links"
                        title="Links"
                        className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors outline-none"
                    >
                        <img
                            src={amfaizIcon}
                            alt=""
                            className="size-4 object-contain"
                        />
                    </MenuTrigger>
                    <MenuContent sideOffset={4} className="w-52">
                        <MenuItem
                            onClick={() =>
                                window.open('https://amfaiz.com/', '_blank')
                            }
                        >
                            <Globe className="size-3.5" />
                            <span>Website</span>
                        </MenuItem>
                        <MenuItem
                            onClick={() =>
                                window.open(
                                    'https://www.whatsapp.com/channel/0029VbD72j97oQhZ0X5eKT0V',
                                    '_blank',
                                )
                            }
                        >
                            <Whatsapp className="size-3.5" />
                            <span>WhatsApp</span>
                        </MenuItem>
                    </MenuContent>
                </Menu>
            </div>
        </aside>
    )
}
