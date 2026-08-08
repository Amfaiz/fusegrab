import type { DownloadItem } from './types'

interface DownloaderFooterProps {
    items: DownloadItem[]
    activeFilter: string
    setActiveFilter: (filter: string) => void
}

export function DownloaderFooter({
    items,
    activeFilter,
    setActiveFilter,
}: DownloaderFooterProps) {
    return (
        <div className="border-border bg-surface text-muted-foreground flex h-9 w-full shrink-0 items-center justify-between border-t px-4 text-xs select-none">
            <div className="flex items-center gap-4">
                <span>
                    Total Items:{' '}
                    <strong className="text-foreground font-mono">
                        {items.length}
                    </strong>
                </span>
                <span>
                    Selected:{' '}
                    <strong className="text-primary font-mono">
                        {items.filter((i) => i.selected).length}
                    </strong>
                </span>
            </div>

            <div className="flex items-center gap-2 text-[11px]">
                <button
                    type="button"
                    onClick={() =>
                        setActiveFilter(
                            activeFilter === 'unfinished'
                                ? 'all'
                                : 'unfinished',
                        )
                    }
                    className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors ${
                        activeFilter === 'unfinished'
                            ? 'bg-accent text-foreground font-medium'
                            : 'hover:bg-muted text-muted-foreground'
                    }`}
                >
                    <span>In Progress:</span>
                    <span className="text-primary font-mono font-semibold">
                        {items.filter((i) => i.status === 'Downloading').length}
                    </span>
                </button>

                <button
                    type="button"
                    onClick={() =>
                        setActiveFilter(
                            activeFilter === 'finished' ? 'all' : 'finished',
                        )
                    }
                    className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors ${
                        activeFilter === 'finished'
                            ? 'bg-accent text-foreground font-medium'
                            : 'hover:bg-muted text-muted-foreground'
                    }`}
                >
                    <span>Finished:</span>
                    <span className="text-success font-mono font-semibold">
                        {items.filter((i) => i.status === 'Complete').length}
                    </span>
                </button>

                <button
                    type="button"
                    onClick={() =>
                        setActiveFilter(
                            activeFilter === 'paused' ? 'all' : 'paused',
                        )
                    }
                    className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors ${
                        activeFilter === 'paused'
                            ? 'bg-accent text-foreground font-medium'
                            : 'hover:bg-muted text-muted-foreground'
                    }`}
                >
                    <span>Paused:</span>
                    <span className="font-mono font-semibold text-amber-500">
                        {items.filter((i) => i.status === 'Paused').length}
                    </span>
                </button>
            </div>
        </div>
    )
}
