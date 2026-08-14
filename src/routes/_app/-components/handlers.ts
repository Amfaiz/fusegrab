import type { DownloadItem } from './types'

export async function pauseSelectedItems(
    items: DownloadItem[],
    setItems: React.Dispatch<React.SetStateAction<DownloadItem[]>>,
) {
    const hasSelection = items.some((i) => i.selected)
    const targetItems = hasSelection ? items.filter((i) => i.selected) : items
    const hasDownloading = targetItems.some((i) => i.status === 'Downloading')

    const targetIds = new Set(targetItems.map((i) => i.id))

    setItems((prev) =>
        prev.map((i) => {
            if (
                targetIds.has(i.id) &&
                (i.status === 'Downloading' || i.status === 'Queued')
            ) {
                return {
                    ...i,
                    status: 'Paused',
                    statusStage: undefined,
                    speed: undefined,
                }
            }
            return i
        }),
    )

    if (hasDownloading) {
        try {
            await window.api.youtube.cancelDownload()
        } catch {}
    }
}

export async function stopItemById(
    id: string,
    items: DownloadItem[],
    setItems: React.Dispatch<React.SetStateAction<DownloadItem[]>>,
) {
    const item = items.find((i) => i.id === id)
    if (item?.status === 'Downloading') {
        try {
            await window.api.youtube.cancelDownload()
        } catch {}
    }

    if (item?.savePath && item.status !== 'Complete') {
        await window.files
            .deletePartialFile(item.savePath)
            .catch(() => undefined)
    }

    setItems((prev) =>
        prev.map((i) =>
            i.id === id
                ? {
                      ...i,
                      status: 'Paused',
                      statusStage: undefined,
                      speed: undefined,
                  }
                : i,
        ),
    )
}

export async function deleteItemById(
    id: string,
    items: DownloadItem[],
    setItems: React.Dispatch<React.SetStateAction<DownloadItem[]>>,
) {
    const item = items.find((i) => i.id === id)
    if (item?.status === 'Downloading') {
        try {
            await window.api.youtube.cancelDownload()
        } catch {}
    }

    if (item?.savePath && item.status !== 'Complete') {
        await window.files
            .deletePartialFile(item.savePath)
            .catch(() => undefined)
    }

    setItems((prev) => prev.filter((i) => i.id !== id))
}

export async function deleteSelectedItems(
    items: DownloadItem[],
    setItems: React.Dispatch<React.SetStateAction<DownloadItem[]>>,
) {
    const hasSelection = items.some((i) => i.selected)
    const targetItems = hasSelection ? items.filter((i) => i.selected) : items
    const hasDownloading = targetItems.some((i) => i.status === 'Downloading')

    if (hasDownloading) {
        try {
            await window.api.youtube.cancelDownload()
        } catch {}
    }

    for (const item of targetItems) {
        if (item.savePath && item.status !== 'Complete') {
            await window.files
                .deletePartialFile(item.savePath)
                .catch(() => undefined)
        }
    }

    const targetIds = new Set(targetItems.map((i) => i.id))

    setItems((prev) => prev.filter((i) => !targetIds.has(i.id)))
}
