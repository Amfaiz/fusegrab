import type { DownloadItem } from './types'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
    ChevronDownIcon,
    Download,
    Folder,
    FolderOpen,
    Youtube,
    MoreHorizontal,
    Pause,
    Play,
    RefreshCw,
    Trash2,
    Video,
} from '#/components/icons'
import { Checkbox } from '#/components/ui/checkbox'
import {
    Menu,
    MenuContent,
    MenuItem,
    MenuSeparator,
    MenuTrigger,
} from '#/components/ui/menu'
import {
    Select,
    SelectContent,
    SelectIcon,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'

import { isBotCheckError } from './retry'
import { getStatusText } from './types'

/**
 * `Retry` is amber rather than red: the item is still going to be attempted, so
 * flagging it as an outright failure would overstate what happened.
 */
function statusTextClass(status: DownloadItem['status']): string {
    switch (status) {
        case 'Complete':
            return 'text-success'
        case 'Error':
        case 'Missing':
        case 'Failed':
            return 'text-danger font-semibold'
        case 'Downloading':
            return 'text-primary font-semibold'
        case 'Ready':
            return 'font-medium text-emerald-500'
        case 'Retry':
            return 'font-medium text-amber-500'
        default:
            return 'text-muted-foreground'
    }
}

function progressBarClass(status: DownloadItem['status']): string {
    switch (status) {
        case 'Complete':
            return 'bg-success'
        case 'Error':
        case 'Missing':
        case 'Failed':
            return 'bg-danger'
        case 'Retry':
            return 'bg-amber-500'
        default:
            return 'bg-primary'
    }
}

interface DownloaderTableProps {
    filteredItems: DownloadItem[]
    setItems: React.Dispatch<React.SetStateAction<DownloadItem[]>>
    allSelected: boolean
    isIndeterminate: boolean
    toggleSelectAll: (checked: boolean) => void
    onToggleItemSelect?: (id: string, selected: boolean) => void
    onAddUrl: () => void
    onStartItem: (id: string) => void
    onStopItem: (id: string) => void
    onDeleteItem?: (id: string) => void
    onOpenFolder?: (item: DownloadItem) => void
    onSignIn?: () => void
    isFetchingVideos?: boolean
}

export function DownloaderTable({
    filteredItems,
    setItems,
    allSelected,
    isIndeterminate,
    toggleSelectAll,
    onToggleItemSelect,
    onAddUrl,
    onStartItem,
    onStopItem,
    onDeleteItem,
    onOpenFolder,
    onSignIn,
    isFetchingVideos,
}: DownloaderTableProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [scrollTop, setScrollTop] = useState(0)
    const [containerHeight, setContainerHeight] = useState(600)

    const ROW_HEIGHT = 57
    const OVERSCAN = 8

    useEffect(() => {
        const el = containerRef.current
        if (!el) return

        const updateHeight = () => {
            if (el.clientHeight > 0) {
                setContainerHeight(el.clientHeight)
            }
        }
        updateHeight()

        const observer = new ResizeObserver(updateHeight)
        observer.observe(el)

        return () => observer.disconnect()
    }, [])

    const handleScroll = useCallback(() => {
        if (containerRef.current) {
            setScrollTop(containerRef.current.scrollTop)
        }
    }, [])

    const totalCount = filteredItems.length
    const startIndex = Math.max(
        0,
        Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN,
    )
    const endIndex = Math.min(
        totalCount,
        Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN,
    )

    const topPadding = startIndex * ROW_HEIGHT
    const bottomPadding = (totalCount - endIndex) * ROW_HEIGHT

    const visibleItems = filteredItems.slice(startIndex, endIndex)

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto"
        >
            <table className="w-full table-fixed border-separate border-spacing-0 text-left text-xs">
                <thead className="sticky top-0 z-20">
                    <tr className="text-muted-foreground/80 text-xs font-normal select-none">
                        <th className="border-border bg-surface sticky top-0 z-20 w-10 border-b px-3 py-2.5 text-center font-normal">
                            <Checkbox
                                checked={allSelected}
                                indeterminate={isIndeterminate}
                                onCheckedChange={(c) =>
                                    toggleSelectAll(Boolean(c))
                                }
                                aria-label="Select all"
                            />
                        </th>
                        <th className="border-border bg-surface sticky top-0 z-20 border-b px-3 py-2.5 font-normal">
                            Name
                        </th>
                        <th className="border-border bg-surface sticky top-0 z-20 w-30 border-b px-3 py-2.5 font-normal">
                            Quality
                        </th>
                        <th className="border-border bg-surface sticky top-0 z-20 w-48 border-b px-3 py-2.5 font-normal">
                            Status
                        </th>
                        <th className="border-border bg-surface sticky top-0 z-20 w-32 border-b px-3 py-2.5 font-normal">
                            Last Modification
                        </th>
                        <th className="border-border bg-surface sticky top-0 z-20 w-14 border-b px-4 py-2.5 text-center font-normal"></th>
                    </tr>
                </thead>
                <tbody>
                    {totalCount === 0 ? (
                        <tr>
                            <td
                                colSpan={6}
                                className="text-muted-foreground py-12 text-center"
                            >
                                <div className="flex flex-col items-center justify-center gap-2">
                                    <Download className="h-8 w-8 opacity-40" />
                                    <p className="text-xs">
                                        No downloads in this list.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={onAddUrl}
                                        disabled={isFetchingVideos}
                                        className="bg-accent text-foreground border-border hover:bg-muted mt-1 rounded-full border px-3 py-1 text-xs disabled:pointer-events-none disabled:opacity-40"
                                    >
                                        + Add YouTube Link
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ) : (
                        <>
                            {topPadding > 0 && (
                                <tr
                                    style={{ height: `${topPadding}px` }}
                                    aria-hidden="true"
                                >
                                    <td colSpan={6} className="border-0 p-0" />
                                </tr>
                            )}
                            {visibleItems.map((item) => (
                                <tr
                                    key={item.id}
                                    className={`group transition-colors ${
                                        item.selected
                                            ? 'bg-accent/40 hover:bg-accent/60'
                                            : 'hover:bg-muted/50'
                                    }`}
                                >
                                    {/* Checkbox */}
                                    <td className="w-10 px-3 py-3.5 text-center">
                                        <Checkbox
                                            checked={item.selected}
                                            onCheckedChange={(checked) => {
                                                if (onToggleItemSelect) {
                                                    onToggleItemSelect(
                                                        item.id,
                                                        Boolean(checked),
                                                    )
                                                } else {
                                                    setItems((prev) =>
                                                        prev.map((i) =>
                                                            i.id === item.id
                                                                ? {
                                                                      ...i,
                                                                      selected:
                                                                          Boolean(
                                                                              checked,
                                                                          ),
                                                                  }
                                                                : i,
                                                        ),
                                                    )
                                                }
                                            }}
                                            aria-label={`Select ${item.name}`}
                                        />
                                    </td>

                                    {/* Name */}
                                    <td className="min-w-0 px-3 py-3.5">
                                        <div className="flex min-w-0 items-center gap-2.5">
                                            {item.type === 'channel' ? (
                                                <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                                            ) : (
                                                <Video className="text-primary h-4 w-4 shrink-0" />
                                            )}
                                            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                                                <span
                                                    className="text-foreground block truncate text-xs font-medium"
                                                    title={item.name}
                                                >
                                                    {item.name}
                                                </span>
                                                {item.channelName && (
                                                    <span className="text-muted-foreground block truncate text-[10px]">
                                                        {item.channelName}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </td>

                                    {/* Quality Selector */}
                                    <td className="px-3 py-3.5">
                                        <Select
                                            value={item.quality || 'Best'}
                                            onValueChange={(val) => {
                                                if (!val) return
                                                setItems((prev) =>
                                                    prev.map((i) =>
                                                        i.id === item.id
                                                            ? {
                                                                  ...i,
                                                                  quality: val,
                                                              }
                                                            : i,
                                                    ),
                                                )
                                            }}
                                            disabled={
                                                item.status === 'Downloading' ||
                                                item.status === 'Complete'
                                            }
                                        >
                                            <SelectTrigger className="border-border/70 bg-accent/40 hover:bg-accent h-7 w-26 justify-between px-2 text-xs font-medium whitespace-nowrap">
                                                <SelectValue
                                                    placeholder="Best"
                                                    className="truncate whitespace-nowrap"
                                                />
                                                <SelectIcon className="text-muted-foreground ml-1 shrink-0">
                                                    <ChevronDownIcon className="size-3" />
                                                </SelectIcon>
                                            </SelectTrigger>
                                            <SelectContent align="start">
                                                <SelectItem value="Best">
                                                    Best
                                                </SelectItem>
                                                <SelectItem value="1080p">
                                                    1080p
                                                </SelectItem>
                                                <SelectItem value="720p">
                                                    720p
                                                </SelectItem>
                                                <SelectItem value="480p">
                                                    480p
                                                </SelectItem>
                                                <SelectItem value="360p">
                                                    360p
                                                </SelectItem>
                                                <SelectItem value="Audio Only">
                                                    Audio Only
                                                </SelectItem>
                                                <SelectItem value="Thumbnail">
                                                    Thumbnail
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </td>

                                    {/* Status & Progress */}
                                    <td className="w-48 min-w-0 px-3 py-3.5">
                                        <div className="flex w-full min-w-0 flex-col gap-1 overflow-hidden">
                                            <div className="flex items-center justify-between text-[11px]">
                                                <span
                                                    className={`truncate font-medium ${statusTextClass(item.status)}`}
                                                >
                                                    {getStatusText(item)}
                                                </span>
                                            </div>

                                            {item.status !== 'Queued' &&
                                                item.status !== 'Ready' && (
                                                    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                                                        <div
                                                            className={`h-full transition-all duration-300 ${progressBarClass(item.status)}`}
                                                            style={{
                                                                width: `${
                                                                    item.status ===
                                                                    'Complete'
                                                                        ? 100
                                                                        : item.percent ||
                                                                          0
                                                                }%`,
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                        </div>
                                    </td>

                                    {/* Last Modification */}
                                    <td className="text-muted-foreground truncate px-3 py-3.5 font-mono text-[11px]">
                                        {item.dateModified}
                                    </td>

                                    {/* Actions / Menu */}
                                    <td className="w-14 px-4 py-3.5 text-center">
                                        <Menu>
                                            <MenuTrigger className="hover:bg-muted text-muted-foreground hover:text-foreground inline-flex size-6 items-center justify-center rounded-md transition-colors">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </MenuTrigger>
                                            <MenuContent
                                                sideOffset={4}
                                                align="end"
                                            >
                                                {item.savePath &&
                                                    item.status ===
                                                        'Complete' && (
                                                        <MenuItem
                                                            onClick={() => {
                                                                if (
                                                                    onOpenFolder
                                                                ) {
                                                                    onOpenFolder(
                                                                        item,
                                                                    )
                                                                } else {
                                                                    window.files.reveal(
                                                                        item.savePath!,
                                                                    )
                                                                }
                                                            }}
                                                        >
                                                            <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                                                            <span>
                                                                Open Folder
                                                            </span>
                                                        </MenuItem>
                                                    )}
                                                {item.status ===
                                                'Downloading' ? (
                                                    <MenuItem
                                                        onClick={() =>
                                                            onStopItem(item.id)
                                                        }
                                                    >
                                                        <Pause className="h-3.5 w-3.5 text-amber-500" />
                                                        <span>Pause</span>
                                                    </MenuItem>
                                                ) : item.status === 'Queued' ? (
                                                    <MenuItem
                                                        onClick={() => {
                                                            setItems((prev) =>
                                                                prev.map((i) =>
                                                                    i.id ===
                                                                    item.id
                                                                        ? {
                                                                              ...i,
                                                                              status: 'Paused',
                                                                              statusStage:
                                                                                  undefined,
                                                                          }
                                                                        : i,
                                                                ),
                                                            )
                                                        }}
                                                    >
                                                        <Pause className="h-3.5 w-3.5 text-amber-500" />
                                                        <span>Dequeue</span>
                                                    </MenuItem>
                                                ) : item.status === 'Paused' ||
                                                  item.status === 'Stopped' ||
                                                  item.status === 'Ready' ? (
                                                    <MenuItem
                                                        onClick={() =>
                                                            onStartItem(item.id)
                                                        }
                                                    >
                                                        <Play className="text-success h-3.5 w-3.5" />
                                                        <span>
                                                            {item.status ===
                                                            'Ready'
                                                                ? 'Start Download'
                                                                : 'Resume'}
                                                        </span>
                                                    </MenuItem>
                                                ) : item.status ===
                                                  'Complete' ? (
                                                    <MenuItem
                                                        onClick={() =>
                                                            onStartItem(item.id)
                                                        }
                                                    >
                                                        <RefreshCw className="text-primary h-3.5 w-3.5" />
                                                        <span>Redownload</span>
                                                    </MenuItem>
                                                ) : item.status === 'Retry' ||
                                                  item.status === 'Failed' ? (
                                                    <MenuItem
                                                        onClick={() =>
                                                            onStartItem(item.id)
                                                        }
                                                    >
                                                        <RefreshCw className="text-primary h-3.5 w-3.5" />
                                                        <span>Retry Now</span>
                                                    </MenuItem>
                                                ) : (
                                                    <MenuItem
                                                        onClick={() =>
                                                            onStartItem(item.id)
                                                        }
                                                    >
                                                        <Download className="text-primary h-3.5 w-3.5" />
                                                        <span>Download</span>
                                                    </MenuItem>
                                                )}
                                                {item.statusStage &&
                                                isBotCheckError(
                                                    item.statusStage,
                                                ) &&
                                                onSignIn ? (
                                                    <>
                                                        <MenuSeparator />
                                                        <MenuItem
                                                            onClick={onSignIn}
                                                        >
                                                            <Youtube className="text-primary h-3.5 w-3.5" />
                                                            <span>
                                                                Sign in to
                                                                YouTube
                                                            </span>
                                                        </MenuItem>
                                                    </>
                                                ) : null}
                                                <MenuSeparator />
                                                <MenuItem
                                                    onClick={() => {
                                                        if (onDeleteItem) {
                                                            onDeleteItem(
                                                                item.id,
                                                            )
                                                        } else {
                                                            setItems((prev) =>
                                                                prev.filter(
                                                                    (i) =>
                                                                        i.id !==
                                                                        item.id,
                                                                ),
                                                            )
                                                        }
                                                    }}
                                                    className="text-danger hover:bg-danger/10 focus:bg-danger/10"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                    <span>
                                                        Delete from List
                                                    </span>
                                                </MenuItem>
                                            </MenuContent>
                                        </Menu>
                                    </td>
                                </tr>
                            ))}
                            {bottomPadding > 0 && (
                                <tr
                                    style={{ height: `${bottomPadding}px` }}
                                    aria-hidden="true"
                                >
                                    <td colSpan={6} className="border-0 p-0" />
                                </tr>
                            )}
                        </>
                    )}
                </tbody>
            </table>
        </div>
    )
}
