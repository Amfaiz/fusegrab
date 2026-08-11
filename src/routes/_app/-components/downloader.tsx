import type { DownloadItem } from './types'

import { useEffect, useRef, useState } from 'react'

import { AppBrand } from '#/components/app-brand'
import { Search } from '#/components/icons'
import { InputField, InputIcon, InputRoot } from '#/components/ui/input'
import { useWindowDrag } from '#/hooks/use-window-drag'

import { AddUrlModal } from './add-dialog'
import { FileMissingDialog } from './file-missing-dialog'
import { DownloaderFooter } from './footer'
import {
    deleteItemById,
    deleteSelectedItems,
    pauseSelectedItems,
    stopItemById,
} from './handlers'
import { DownloadOptionsModal } from './options-dialog'
import {
    applyDownloadFailure,
    isBotCheckError,
    selectNextDownload,
} from './retry'
import { DownloaderSidebar } from './sidebar'
import { SignInScreen } from './sign-in-screen'
import { SplashScreen } from './splash-screen'
import { DownloaderTable } from './table'
import { DownloaderToolbar } from './toolbar'
import { formatDate, sanitizeFilename } from './types'

const isMac =
    typeof window !== 'undefined' &&
    (window.windowControls?.platform === 'darwin' ||
        (typeof navigator !== 'undefined' &&
            navigator.userAgent.includes('Mac')))

const ITEMS_KEY = 'fuse_download_items_v2'

// The table is mirrored into the main process, which writes it to disk
// atomically and flushes on quit. localStorage is only read as a fallback so
// tables saved by older builds survive the upgrade.
function loadSavedItems(): DownloadItem[] | null {
    const fromStore = window.store?.getSync<DownloadItem[]>(ITEMS_KEY)
    if (Array.isArray(fromStore)) return fromStore

    const saved = localStorage.getItem(ITEMS_KEY)
    if (!saved) return null
    try {
        const parsed: unknown = JSON.parse(saved)
        return Array.isArray(parsed) ? (parsed as DownloadItem[]) : null
    } catch {
        return null
    }
}

export function YoutubeDownloader() {
    const dragProps = useWindowDrag()

    const [items, setItems] = useState<DownloadItem[]>(() => {
        const parsed = loadSavedItems()
        if (!parsed) return []
        return parsed.map((item) => {
            const isSingleUrl = item.isSingleUrl ?? item.type === 'video'
            // Nothing may auto-start on launch. A pending retry is parked
            // as Ready with a fresh budget so the sweep does not fire off
            // a download the moment the window opens.
            if (
                item.status === 'Downloading' ||
                item.status === 'Queued' ||
                item.status === 'Retry' ||
                item.statusStage === 'Preparing...'
            ) {
                return {
                    ...item,
                    isSingleUrl,
                    status: 'Ready' as const,
                    statusStage: undefined,
                    retryCount: undefined,
                }
            }
            return { ...item, isSingleUrl }
        })
    })

    const [activeFilter, setActiveFilter] = useState('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [showAddUrlModal, setShowAddUrlModal] = useState(false)
    const [showOptionsModal, setShowOptionsModal] = useState(false)
    const [inputUrl, setInputUrl] = useState('')
    const [loadingInfo, setLoadingInfo] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [signedIn, setSignedIn] = useState<boolean | null>(null)
    const [accountInfo, setAccountInfo] = useState<{
        name: string
        avatarUrl: string | null
        email: string | null
    } | null>(null)
    const [signInDismissed, setSignInDismissed] = useState(false)
    const [signInStatus, setSignInStatus] = useState<
        'idle' | 'opened' | 'signed-in' | 'closed' | 'signed-out'
    >('idle')
    // The Google sign-in URL to load in the embedded webview, set on 'opened'.
    const [signInUrl, setSignInUrl] = useState<string | null>(null)
    // Keep the splash up for a moment even when the session check resolves
    // instantly, so startup never flashes the wrong screen.
    const [splashElapsed, setSplashElapsed] = useState(false)
    useEffect(() => {
        const timer = setTimeout(() => setSplashElapsed(true), 2500)
        return () => clearTimeout(timer)
    }, [])
    const [downloadDir, setDownloadDir] = useState<string>('')
    const downloadDirRef = useRef('')
    const [isDownloading, setIsDownloading] = useState(false)
    const [activeItemUrl, setActiveItemUrl] = useState<string | null>(null)
    const [missingFileItem, setMissingFileItem] = useState<DownloadItem | null>(
        null,
    )
    const [isFetchingVideos, setIsFetchingVideos] = useState(false)
    const [fetchingTitle, setFetchingTitle] = useState('')
    const [defaultQuality, setDefaultQuality] = useState<string>(() => {
        return localStorage.getItem('yt_default_quality') || 'Best'
    })

    const isDownloadingRef = useRef(false)
    // Each backend download is assigned a run id. Cancelling a download invalidates
    // its run immediately, so its eventual close/error events cannot affect a newer
    // download that was started by Resume.
    const activeRunIdRef = useRef(0)

    const handleDefaultQualityChange = (quality: string) => {
        setDefaultQuality(quality)
        localStorage.setItem('yt_default_quality', quality)
        setItems((prev) =>
            prev.map((i) =>
                i.status !== 'Complete' && i.status !== 'Downloading'
                    ? { ...i, quality }
                    : i,
            ),
        )
    }

    const [selectedByFilter, setSelectedByFilter] = useState<
        Record<string, Set<string>>
    >(() => {
        const saved = localStorage.getItem('fuse_selected_by_filter')
        if (saved) {
            try {
                const parsed: Record<string, string[]> = JSON.parse(saved)
                const restored: Record<string, Set<string>> = {}
                for (const k of Object.keys(parsed)) {
                    restored[k] = new Set(parsed[k])
                }
                return restored
            } catch {}
        }
        return {}
    })

    useEffect(() => {
        const toSave: Record<string, string[]> = {}
        for (const k of Object.keys(selectedByFilter)) {
            if (selectedByFilter[k].size > 0) {
                toSave[k] = Array.from(selectedByFilter[k])
            }
        }
        localStorage.setItem('fuse_selected_by_filter', JSON.stringify(toSave))
    }, [selectedByFilter])

    useEffect(() => {
        localStorage.setItem(ITEMS_KEY, JSON.stringify(items))
        void window.store?.set(ITEMS_KEY, items)
    }, [items])

    // A force quit gives the renderer no chance to run, so make sure the last
    // change is on disk as soon as the window starts going away.
    useEffect(() => {
        const flush = () => {
            void window.store?.flush()
        }
        window.addEventListener('beforeunload', flush)
        window.addEventListener('pagehide', flush)
        return () => {
            window.removeEventListener('beforeunload', flush)
            window.removeEventListener('pagehide', flush)
        }
    }, [])

    useEffect(() => {
        window.files.getDefaultDownloadDir().then((defaultPath) => {
            const saved = localStorage.getItem('yt_download_dir')
            const dir = saved || defaultPath
            setDownloadDir(dir)
            downloadDirRef.current = dir
        })
    }, [])

    const activeItemUrlRef = useRef<string | null>(null)
    useEffect(() => {
        activeItemUrlRef.current = activeItemUrl
    }, [activeItemUrl])

    const normalizeProgressPercent = (percent: unknown) => {
        if (typeof percent !== 'number' || !Number.isFinite(percent)) return 0
        return Math.max(0, Math.min(100, percent))
    }

    // Mount-only: recover orphan statuses from crash/shutdown
    useEffect(() => {
        window.api.youtube.getDownloadState().then((ds) => {
            const isBackendDownloading = Boolean(
                ds && ds.isDownloading && ds.url,
            )
            if (isBackendDownloading && ds?.url) {
                isDownloadingRef.current = true
                setIsDownloading(true)
                setActiveItemUrl(ds.url)
            } else {
                isDownloadingRef.current = false
                setIsDownloading(false)
                setActiveItemUrl(null)
            }

            // Recovery: Cleanup orphan statuses left from sudden crash/shutdown
            setItems((prev) => {
                let changed = false
                const updated = prev.map((item) => {
                    const isItemActiveInBackend =
                        isBackendDownloading && ds?.url && item.url === ds.url

                    if (
                        !isItemActiveInBackend &&
                        (item.status === 'Downloading' ||
                            item.status === 'Queued' ||
                            item.statusStage === 'Preparing...')
                    ) {
                        changed = true
                        return {
                            ...item,
                            status: 'Ready' as const,
                            statusStage: undefined,
                        }
                    }
                    return item
                })
                return changed ? updated : prev
            })
        })
    }, [])

    // Progress listeners — use refs so we don't need to re-register
    useEffect(() => {
        const offSingle = window.api.youtube.onProgress((data) => {
            if (!data) return
            setIsDownloading(true)

            setItems((prev) =>
                prev.map((item) => {
                    if (
                        activeItemUrlRef.current
                            ? item.url === activeItemUrlRef.current
                            : item.status === 'Downloading'
                    ) {
                        const newPercent = normalizeProgressPercent(
                            data.percent,
                        )
                        return {
                            ...item,
                            status: 'Downloading',
                            percent: newPercent,
                            statusStage:
                                newPercent >= 99
                                    ? 'Finalizing...'
                                    : newPercent > 0
                                      ? undefined
                                      : 'Preparing...',
                        }
                    }
                    return item
                }),
            )
        })

        const offChannel = window.api.youtube.onChannelProgress((data) => {
            if (!data) return
            setIsDownloading(data.status === 'downloading')

            setItems((prev) =>
                prev.map((item) => {
                    if (
                        activeItemUrlRef.current
                            ? item.url === activeItemUrlRef.current
                            : item.status === 'Downloading'
                    ) {
                        if (data.status === 'completed') {
                            return {
                                ...item,
                                status: 'Complete',
                                percent: 100,
                                statusStage: undefined,
                            }
                        }
                        return {
                            ...item,
                            status:
                                data.status === 'downloading'
                                    ? 'Downloading'
                                    : item.status,
                            percent: normalizeProgressPercent(data.percent),
                            statusStage: data.videoTitle
                                ? `Downloading: ${data.videoTitle}`
                                : undefined,
                        }
                    }
                    return item
                }),
            )
        })

        return () => {
            offSingle()
            offChannel()
        }
    }, [])

    function extractVideoId(url: string): string | null {
        if (!url) return null
        const match = url.match(
            /(?:watch\?v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/,
        )
        return match ? match[1] : null
    }

    // Sign-in: the user logs into YouTube once in their real browser, the app
    // imports the session into the yt-dlp jar, and 'signed-in' is emitted when
    // it lands. While no session exists the whole app is gated behind
    // SignInScreen. Account info is pre-fetched in parallel here (during the
    // splash) so the sidebar button is ready the moment the splash lifts.
    useEffect(() => {
        let cancelled = false
        const refresh = async () => {
            const [isSignedIn, account] = await Promise.all([
                window.api.youtube.getSignInState(),
                window.api.youtube.getAccountInfo(),
            ])
            if (cancelled) return
            setSignedIn(isSignedIn)
            setAccountInfo(account)
        }
        void refresh()

        const off = window.api.youtube.onSignInState((state) => {
            setSignInStatus(state?.status || 'idle')
            if (state?.status === 'opened') {
                // Re-show the gate even if the user previously skipped it —
                // the embedded sign-in webview only renders inside it, so
                // dismissing it once would otherwise make the sidebar's
                // "Sign in" button a no-op forever.
                setSignInDismissed(false)
                setSignInUrl(state.url ?? null)
            } else if (state?.status === 'signed-in') {
                setSignedIn(true)
                setSignInUrl(null)
                void refresh()
                // The jar now carries a logged-in session: clear a bot-check
                // error in the Add dialog, and reset any bot-check failures so
                // Retry Now starts from a fresh budget.
                setError((prev) =>
                    prev && isBotCheckError(prev) ? null : prev,
                )
                setItems((prev) =>
                    prev.map((i) =>
                        i.statusStage && isBotCheckError(i.statusStage)
                            ? { ...i, retryCount: undefined }
                            : i,
                    ),
                )
            } else if (state?.status === 'signed-out') {
                // Explicit sign-out — re-read so the gate reappears.
                setSignInUrl(null)
                setSignInDismissed(false)
                void refresh()
            } else if (state?.status === 'closed') {
                // Poll timed out without a session — drop the webview and
                // re-read the persisted session so the gate reflects reality.
                setSignInUrl(null)
                void refresh()
            }
        })
        return () => {
            cancelled = true
            off()
        }
    }, [])

    const handleOpenSignIn = () => {
        setSignInUrl(null)
        void window.api.youtube.openSignIn()
    }

    const handleCancelSignIn = () => {
        // Stop the main-process poll too, so the gate's button leaves its
        // "Opening sign-in…" state and a later re-open starts clean.
        setSignInUrl(null)
        setSignInStatus('idle')
        void window.api.youtube.cancelSignIn()
    }

    // The 'signed-out' event from the main process re-reads the session and
    // drops the account info, so the sidebar reverts to the sign-in button.
    const handleSignOut = () => {
        void window.api.youtube.signOut()
    }

    const handleAddUrl = async () => {
        const cleanUrl = inputUrl.trim()
        if (!cleanUrl) return

        const targetVidId = extractVideoId(cleanUrl)
        const alreadyExists = items.some((i) => {
            if (i.url === cleanUrl) return true
            const itemVidId = extractVideoId(i.url)
            return Boolean(
                targetVidId && itemVidId && targetVidId === itemVidId,
            )
        })

        if (alreadyExists) {
            setError('This video is already in your download list.')
            return
        }

        setLoadingInfo(true)
        setError(null)

        try {
            const type = await window.api.youtube.getUrlType(cleanUrl)

            if (type === 'video') {
                const info = await window.api.youtube.getInfo(cleanUrl)
                const newItem: DownloadItem = {
                    id: String(Date.now()),
                    name: info.title,
                    url: cleanUrl,
                    type: 'video',
                    isSingleUrl: true,
                    channelName: info.author,
                    quality: defaultQuality || 'Best',
                    size: 'Calculating...',
                    status: 'Queued',
                    percent: 0,
                    timeLeft: '--',
                    dateModified: formatDate(new Date()),
                    selected: true,
                }
                setItems((prev) => [newItem, ...prev])
                setSelectedByFilter((prev) => {
                    const currentSet = new Set(prev[activeFilter] || [])
                    currentSet.add(newItem.id)
                    return { ...prev, [activeFilter]: currentSet }
                })
            } else if (type === 'channel') {
                setIsFetchingVideos(true)
                // Await initial batch loading before closing dialog
                await window.api.youtube.getChannelPage(cleanUrl, 1, 20)
                setInputUrl('')
                setShowAddUrlModal(false)
                return
            }

            setInputUrl('')
            setShowAddUrlModal(false)
        } catch (err: any) {
            setIsFetchingVideos(false)
            setError(err?.message || 'Failed to fetch YouTube info')
        } finally {
            setLoadingInfo(false)
        }
    }

    useEffect(() => {
        const offBatch = window.api.youtube.onChannelVideoBatch((batch) => {
            if (!batch) return

            if (batch.channelTitle) {
                setFetchingTitle(batch.channelTitle)
            }

            if (batch.isDone) {
                setIsFetchingVideos(false)
                setFetchingTitle('')
            } else {
                setIsFetchingVideos(true)
            }

            if (!Array.isArray(batch.videos) || batch.videos.length === 0)
                return

            setItems((prev) => {
                const existingUrls = new Set(prev.map((i) => i.url))
                const existingVideoIds = new Set(
                    prev
                        .map((i) => extractVideoId(i.url))
                        .filter(Boolean) as string[],
                )
                const newItems: DownloadItem[] = []

                for (const v of batch.videos) {
                    const vId = extractVideoId(v.url) || v.id
                    if (
                        existingUrls.has(v.url) ||
                        (vId && existingVideoIds.has(vId))
                    ) {
                        continue
                    }
                    existingUrls.add(v.url)
                    if (vId) existingVideoIds.add(vId)

                    newItems.push({
                        id: `${v.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        name: v.title,
                        url: v.url,
                        type: 'video',
                        isSingleUrl: false,
                        channelName: v.author || batch.channelTitle,
                        quality: defaultQuality || 'Best',
                        size: 'Calculating...',
                        status: 'Ready',
                        percent: 0,
                        timeLeft: '--',
                        dateModified: formatDate(new Date()),
                        selected: false,
                    })
                }

                if (newItems.length === 0) return prev
                return [...prev, ...newItems]
            })
        })

        return () => {
            offBatch()
        }
    }, [])

    const pauseRequestedRef = useRef<Set<string>>(new Set())

    const toDownloadingItem = (item: DownloadItem): DownloadItem => ({
        ...item,
        status: 'Downloading',
        percent: 0,
        statusStage: 'Preparing...',
    })

    const invalidateActiveDownload = () => {
        activeRunIdRef.current += 1
        isDownloadingRef.current = false
        setIsDownloading(false)
        setActiveItemUrl(null)
    }

    const startDownloadRun = (item: DownloadItem) => {
        const runId = activeRunIdRef.current + 1
        activeRunIdRef.current = runId
        isDownloadingRef.current = true
        setIsDownloading(true)
        setActiveItemUrl(item.url)
        setItems((prev) =>
            prev.map((i) => (i.id === item.id ? toDownloadingItem(i) : i)),
        )
        processDownloadItem(item, runId)
    }

    useEffect(() => {
        if (isDownloadingRef.current) return

        const next = selectNextDownload(items, (id) =>
            pauseRequestedRef.current.has(id),
        )
        if (!next) return

        if (next.kind === 'queued') {
            startDownloadRun(next.item)
            return
        }

        const attempt = (next.item.retryCount || 0) + 1
        setItems((prev) =>
            prev.map((i) =>
                i.id === next.item.id ? { ...i, retryCount: attempt } : i,
            ),
        )
        startDownloadRun({ ...next.item, retryCount: attempt })
    }, [items, isDownloading])

    const handleStartSelectedDownloads = (targetItemId?: string) => {
        const hasSelection = filteredItems.some((i) => i.selected)
        const eligible = filteredItems.filter((i) => {
            if (targetItemId) return i.id === targetItemId
            if (hasSelection) return i.selected && i.status !== 'Complete'
            return i.status !== 'Complete'
        })
        if (eligible.length === 0) return

        const firstItem = eligible[0]
        const canStartImmediately = !isDownloadingRef.current

        const targetIds = new Set(eligible.map((e) => e.id))
        for (const id of targetIds) {
            pauseRequestedRef.current.delete(id)
        }

        setItems((prev) =>
            prev.map((i) => {
                if (targetIds.has(i.id)) {
                    // An explicit Start is a fresh attempt: clear the retry budget
                    // so a Failed item becomes eligible for the sweep again.
                    if (canStartImmediately && i.id === firstItem.id) {
                        return {
                            ...toDownloadingItem(i),
                            retryCount: undefined,
                        }
                    }
                    if (i.status !== 'Complete') {
                        return {
                            ...i,
                            status: 'Queued',
                            statusStage: undefined,
                            retryCount: undefined,
                        }
                    }
                }
                return i
            }),
        )

        if (canStartImmediately) {
            startDownloadRun({ ...firstItem, retryCount: undefined })
        }
    }

    const processDownloadItem = async (item: DownloadItem, runId: number) => {
        let targetDir = downloadDirRef.current
        if (!targetDir) {
            targetDir = await window.files.getDefaultDownloadDir()
            downloadDirRef.current = targetDir
            setDownloadDir(targetDir)
        }

        try {
            if (activeRunIdRef.current !== runId) return
            isDownloadingRef.current = true
            setIsDownloading(true)
            setActiveItemUrl(item.url)

            setItems((prev) =>
                prev.map((i) => (i.id === item.id ? toDownloadingItem(i) : i)),
            )

            if (item.type === 'video') {
                const sanitized = sanitizeFilename(item.name)
                const isAudio = item.quality?.toLowerCase().includes('audio')
                const ext = isAudio ? 'mp3' : 'mp4'

                let savePath: string
                if (item.isSingleUrl) {
                    const individualDir = `${targetDir.replace(/\/$/, '')}/Individual Videos`
                    savePath = `${individualDir}/${sanitized}.${ext}`
                } else {
                    const channelSubfolder = sanitizeFilename(
                        item.channelName || 'Uncategorized',
                    )
                    const channelDir = `${targetDir.replace(/\/$/, '')}/${channelSubfolder}`
                    savePath = `${channelDir}/${sanitized}.${ext}`
                }
                const isBest =
                    !item.quality ||
                    item.quality === 'Best Quality' ||
                    item.quality === 'Best'
                const heightVal = isAudio
                    ? -1
                    : isBest
                      ? undefined
                      : parseInt(item.quality || '', 10) || undefined

                await window.api.youtube.download({
                    url: item.url,
                    savePath,
                    height: heightVal,
                    rootDownloadDir: targetDir,
                })

                if (activeRunIdRef.current === runId) {
                    setItems((prev) =>
                        prev.map((i) =>
                            i.id === item.id
                                ? {
                                      ...i,
                                      status: 'Complete',
                                      percent: 100,
                                      statusStage: undefined,
                                      retryCount: undefined,
                                      savePath,
                                  }
                                : i,
                        ),
                    )
                }
            } else if (item.type === 'channel') {
                const sanitized = sanitizeFilename(item.name)
                const saveDir = `${targetDir.replace(/\/$/, '')}/${sanitized}`

                const isAudio = item.quality?.toLowerCase().includes('audio')
                const isBest =
                    !item.quality ||
                    item.quality === 'Best Quality' ||
                    item.quality === 'Best'
                const heightVal = isAudio
                    ? undefined
                    : isBest
                      ? undefined
                      : parseInt(item.quality || '', 10) || undefined

                await window.api.youtube.downloadChannel({
                    channelUrl: item.url,
                    saveDir,
                    qualityHeight: heightVal,
                    isAudioOnly: isAudio,
                    rootDownloadDir: targetDir,
                })

                if (activeRunIdRef.current === runId) {
                    setItems((prev) =>
                        prev.map((i) =>
                            i.id === item.id
                                ? {
                                      ...i,
                                      status: 'Complete',
                                      percent: 100,
                                      statusStage: undefined,
                                      retryCount: undefined,
                                      savePath: saveDir,
                                  }
                                : i,
                        ),
                    )
                }
            }
        } catch (err: any) {
            // A cancellation invalidates the run before the process exits. Ignore
            // stale process errors so they cannot overwrite a resumed item.
            if (activeRunIdRef.current === runId) {
                const rawMsg = String(err?.message || '')
                const cleanMsg = rawMsg
                    .replace(/^Error invoking remote method '[^']*':\s*/, '')
                    .trim()

                // Defer failures to a retry sweep that runs once the queue drains.
                // Transient causes (throttling, bot checks, CDN hiccups) often clear
                // by then, and moving on keeps one bad URL from stalling the queue.
                setItems((prev) =>
                    prev.map((i) =>
                        i.id === item.id
                            ? applyDownloadFailure(i, cleanMsg)
                            : i,
                    ),
                )
            }
        } finally {
            if (activeRunIdRef.current === runId) {
                isDownloadingRef.current = false
                setIsDownloading(false)
                setActiveItemUrl(null)
            }
        }
    }

    const cleanupDeletedIds = (targetIds: string[]) => {
        const removeSet = new Set(targetIds)
        setSelectedByFilter((prev) => {
            const next: Record<string, Set<string>> = {}
            for (const key of Object.keys(prev)) {
                const updated = new Set(prev[key])
                for (const id of removeSet) {
                    updated.delete(id)
                }
                next[key] = updated
            }
            return next
        })
    }

    const handlePauseSelected = () => {
        const selectedInView = filteredItems.filter((i) => i.selected)
        const targetIds =
            selectedInView.length > 0
                ? selectedInView.map((i) => i.id)
                : filteredItems.map((i) => i.id)
        for (const id of targetIds) {
            pauseRequestedRef.current.add(id)
        }
        if (
            filteredItems.some(
                (i) => targetIds.includes(i.id) && i.status === 'Downloading',
            )
        ) {
            invalidateActiveDownload()
        }
        pauseSelectedItems(filteredItems, setItems)
    }

    const handleStopItem = (id: string) => {
        if (items.find((item) => item.id === id)?.status === 'Downloading') {
            invalidateActiveDownload()
        }
        pauseRequestedRef.current.add(id)
        stopItemById(id, items, setItems)
    }

    const handleDeleteItem = (id: string) => {
        if (items.find((item) => item.id === id)?.status === 'Downloading') {
            invalidateActiveDownload()
        }
        pauseRequestedRef.current.add(id)
        cleanupDeletedIds([id])
        deleteItemById(id, items, setItems)
    }

    const handleDeleteSelected = () => {
        const selectedInView = filteredItems.filter((i) => i.selected)
        const targetIds =
            selectedInView.length > 0
                ? selectedInView.map((i) => i.id)
                : filteredItems.map((i) => i.id)
        for (const id of targetIds) {
            pauseRequestedRef.current.add(id)
        }
        if (
            filteredItems.some(
                (i) => targetIds.includes(i.id) && i.status === 'Downloading',
            )
        ) {
            invalidateActiveDownload()
        }
        cleanupDeletedIds(targetIds)
        deleteSelectedItems(filteredItems, setItems)
    }

    const handleSelectFolder = async () => {
        const selected = await window.files.chooseDirectory()
        if (selected) {
            downloadDirRef.current = selected
            setDownloadDir(selected)
            localStorage.setItem('yt_download_dir', selected)
        }
    }

    const currentSelectedIds =
        selectedByFilter[activeFilter] || new Set<string>()

    const filteredItems = items
        .filter((item) => {
            const matchesSearch =
                !searchQuery.trim() ||
                item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.channelName
                    ?.toLowerCase()
                    .includes(searchQuery.toLowerCase())

            if (!matchesSearch) return false

            if (activeFilter === 'individual') {
                return Boolean(item.isSingleUrl)
            }
            if (activeFilter.startsWith('channel:')) {
                const targetChannel = activeFilter.replace('channel:', '')
                return (
                    !item.isSingleUrl &&
                    (item.channelName || 'Uncategorized') === targetChannel
                )
            }
            if (activeFilter === 'finished') return item.status === 'Complete'
            if (activeFilter === 'unfinished') return item.status !== 'Complete'
            if (activeFilter === 'paused')
                return item.status === 'Paused' || item.status === 'Ready'

            return true
        })
        .map((item) => ({
            ...item,
            selected: currentSelectedIds.has(item.id),
        }))

    const allSelected =
        filteredItems.length > 0 && filteredItems.every((i) => i.selected)
    const someSelected = filteredItems.some((i) => i.selected)
    const isIndeterminate = someSelected && !allSelected

    const toggleSelectAll = (checked: boolean) => {
        const visibleIds = filteredItems.map((i) => i.id)
        setSelectedByFilter((prev) => {
            const nextSet = new Set(prev[activeFilter] || [])
            for (const id of visibleIds) {
                if (checked) {
                    nextSet.add(id)
                } else {
                    nextSet.delete(id)
                }
            }
            return { ...prev, [activeFilter]: nextSet }
        })
    }

    const handleToggleItemSelect = (id: string, checked: boolean) => {
        setSelectedByFilter((prev) => {
            const nextSet = new Set(prev[activeFilter] || [])
            if (checked) {
                nextSet.add(id)
            } else {
                nextSet.delete(id)
            }
            return { ...prev, [activeFilter]: nextSet }
        })
    }

    const handleOpenFolder = async (item: DownloadItem) => {
        if (!item.savePath) return
        const exists = await window.files.reveal(item.savePath)
        if (!exists) {
            setItems((prev) =>
                prev.map((i) =>
                    i.id === item.id
                        ? { ...i, status: 'Missing', statusStage: undefined }
                        : i,
                ),
            )
            setMissingFileItem(item)
        }
    }

    // Windows has no traffic lights on the left, so the brand sits there and the
    // search takes the center. macOS keeps the brand centered and the search on
    // the right, clear of the traffic lights.
    const searchInput = (
        <InputRoot className="h-6.5 w-44 rounded-full lg:w-56">
            <InputIcon>
                <Search className="size-3" />
            </InputIcon>
            <InputField
                placeholder="Search in the List"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-xs"
            />
        </InputRoot>
    )

    const brand = <AppBrand />

    if (signedIn === null || !splashElapsed) {
        // Session check still in flight, or the splash's minimum display time
        // has not passed yet.
        return <SplashScreen />
    }

    if (signedIn !== true && !signInDismissed) {
        return (
            <SignInScreen
                checking={false}
                status={signInStatus}
                url={signInUrl}
                onSignIn={handleOpenSignIn}
                onCancel={handleCancelSignIn}
                onSkip={() => setSignInDismissed(true)}
            />
        )
    }

    return (
        <div className="bg-background text-foreground flex h-full w-full flex-col overflow-hidden font-sans select-none">
            {/* Top Bar / App Header */}
            <div
                className="border-border bg-surface relative flex h-10 w-full shrink-0 items-center justify-between border-b px-3 pr-1.5 pl-1"
                {...dragProps}
            >
                {isMac ? (
                    <>
                        <div className="flex items-center gap-3">
                            <div className="w-16 shrink-0" />
                        </div>

                        {/* Centered App Title */}
                        <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center gap-2">
                            {brand}
                        </div>

                        <div className="flex items-center gap-3">
                            {searchInput}
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-3 pl-1">
                            {brand}
                        </div>

                        {/* Centered Search */}
                        <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center">
                            <div className="pointer-events-auto">
                                {searchInput}
                            </div>
                        </div>

                        <div className="flex items-center gap-3" />
                    </>
                )}
            </div>

            {/* Action Toolbar */}
            <DownloaderToolbar
                items={filteredItems}
                onAddUrl={() => !isFetchingVideos && setShowAddUrlModal(true)}
                onResumeSelected={() => handleStartSelectedDownloads()}
                onPauseSelected={handlePauseSelected}
                onDeleteSelected={handleDeleteSelected}
                onOptions={() => setShowOptionsModal(true)}
                isFetchingVideos={isFetchingVideos}
                fetchingTitle={fetchingTitle}
            />

            {/* Main Body */}
            <div className="flex min-h-0 w-full flex-1 overflow-hidden">
                <DownloaderSidebar
                    items={items}
                    activeFilter={activeFilter}
                    setActiveFilter={setActiveFilter}
                    onSignIn={handleOpenSignIn}
                    onSignOut={handleSignOut}
                    signedIn={signedIn === true}
                    accountInfo={accountInfo}
                />

                <main className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden">
                    <DownloaderTable
                        filteredItems={filteredItems}
                        setItems={setItems}
                        allSelected={allSelected}
                        isIndeterminate={isIndeterminate}
                        toggleSelectAll={toggleSelectAll}
                        onToggleItemSelect={handleToggleItemSelect}
                        onAddUrl={() =>
                            !isFetchingVideos && setShowAddUrlModal(true)
                        }
                        onStartItem={(id) => handleStartSelectedDownloads(id)}
                        onStopItem={handleStopItem}
                        onDeleteItem={handleDeleteItem}
                        onOpenFolder={handleOpenFolder}
                        onSignIn={handleOpenSignIn}
                        isFetchingVideos={isFetchingVideos}
                    />

                    <DownloaderFooter
                        items={filteredItems}
                        activeFilter={activeFilter}
                        setActiveFilter={setActiveFilter}
                    />
                </main>
            </div>

            {/* Modals */}
            <AddUrlModal
                open={showAddUrlModal}
                onOpenChange={setShowAddUrlModal}
                inputUrl={inputUrl}
                setInputUrl={setInputUrl}
                loadingInfo={loadingInfo}
                error={error}
                signInStatus={signInStatus}
                onSignIn={handleOpenSignIn}
                onSubmit={handleAddUrl}
            />

            <DownloadOptionsModal
                open={showOptionsModal}
                onOpenChange={setShowOptionsModal}
                downloadDir={downloadDir}
                onSelectFolder={handleSelectFolder}
                defaultQuality={defaultQuality}
                onDefaultQualityChange={handleDefaultQualityChange}
            />

            <FileMissingDialog
                item={missingFileItem}
                onClose={() => setMissingFileItem(null)}
                onRedownload={(id) => handleStartSelectedDownloads(id)}
            />
        </div>
    )
}
