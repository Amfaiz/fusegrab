import type { DownloadItem } from './types'

import { useState } from 'react'

import { Folder, FolderOpen, Video } from '#/components/icons'

import { UpdatePanel } from './update-panel'

interface DownloaderSidebarProps {
    items: DownloadItem[]
    activeFilter: string
    setActiveFilter: (filter: string) => void
}

export function DownloaderSidebar({
    items,
    activeFilter,
    setActiveFilter,
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
        <aside className="border-border bg-surface flex w-56 shrink-0 flex-col justify-between border-r pt-1.5 pr-0 pb-3 select-none">
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
        </aside>
    )
}
