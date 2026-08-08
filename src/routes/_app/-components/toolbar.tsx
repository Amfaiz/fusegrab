import type { DownloadItem } from './types'

import {
    Loader2,
    Pause,
    Play,
    Plus,
    Settings,
    Trash2,
} from '#/components/icons'

interface DownloaderToolbarProps {
    items: DownloadItem[]
    onAddUrl: () => void
    onResumeSelected: () => void
    onPauseSelected: () => void
    onDeleteSelected: () => void
    onOptions: () => void
    isFetchingVideos?: boolean
    fetchingTitle?: string
}

export function DownloaderToolbar({
    items,
    onAddUrl,
    onResumeSelected,
    onPauseSelected,
    onDeleteSelected,
    onOptions,
    isFetchingVideos,
    fetchingTitle,
}: DownloaderToolbarProps) {
    const hasSelection = items.some((i) => i.selected)
    const selectedItems = items.filter((i) => i.selected)
    const hasActiveSelected = selectedItems.some(
        (i) => i.status === 'Downloading' || i.status === 'Queued',
    )
    const hasResumable = selectedItems.some((i) => i.status !== 'Complete')

    return (
        <div className="border-border bg-surface flex w-full shrink-0 items-center justify-between gap-2 overflow-x-auto border-b p-2 select-none">
            <div className="flex items-center gap-1.5">
                {/* Add URL Primary Button */}
                <button
                    type="button"
                    onClick={onAddUrl}
                    disabled={isFetchingVideos}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium shadow-xs transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                    title={
                        isFetchingVideos
                            ? 'Fetching videos in progress...'
                            : 'Add URL'
                    }
                    aria-label="Add URL"
                >
                    <Plus className="size-3.5" />
                    <span>Add URL</span>
                </button>

                <div className="bg-border/60 mx-1 h-4 w-px" />

                {/* Resume / Pause Toggle Button */}
                {hasActiveSelected ? (
                    <button
                        type="button"
                        onClick={onPauseSelected}
                        disabled={!hasSelection || !hasActiveSelected}
                        className="hover:bg-muted text-foreground/90 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
                        title="Pause Selected Downloads"
                        aria-label="Pause Selected Downloads"
                    >
                        <Pause className="h-3.5 w-3.5 text-amber-500" />
                        <span>Pause</span>
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={onResumeSelected}
                        disabled={!hasSelection || !hasResumable}
                        className="hover:bg-muted text-foreground/90 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
                        title="Resume Selected Downloads"
                        aria-label="Resume Selected Downloads"
                    >
                        <Play className="text-success size-3.5" />
                        <span>Resume</span>
                    </button>
                )}

                {/* Delete Button */}
                <button
                    type="button"
                    onClick={onDeleteSelected}
                    disabled={!hasSelection}
                    className="hover:bg-muted text-foreground/90 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
                    title="Delete Selected Items"
                    aria-label="Delete Selected Items"
                >
                    <Trash2 className="text-danger size-3.5" />
                    <span>Delete</span>
                </button>

                <div className="bg-border/60 mx-1 h-4 w-px" />

                {/* Options */}
                <button
                    type="button"
                    onClick={onOptions}
                    className="hover:bg-muted text-foreground/90 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors"
                    title="Download Settings"
                    aria-label="Download Settings"
                >
                    <Settings className="text-muted-foreground size-3.5" />
                    <span>Options</span>
                </button>
            </div>

            {/* Right Side Live Fetching Indicator */}
            {isFetchingVideos && (
                <div className="animate-in fade-in slide-in-from-right-2 flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-[11px] font-medium tracking-tight text-rose-600 shadow-xs transition-all duration-300 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-400">
                    <Loader2 className="size-3.5 animate-spin text-rose-500" />
                    <span className="max-w-60 truncate">
                        Fetching YouTube videos
                        {fetchingTitle ? `: ${fetchingTitle}` : ''}
                    </span>
                </div>
            )}
        </div>
    )
}
