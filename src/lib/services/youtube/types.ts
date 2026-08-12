export interface YoutubeFormatInfo {
    qualityLabel: string
    container: string
    hasVideo: boolean
    hasAudio: boolean
    itag: number
    height?: number
    isAudioOnly?: boolean
}

export interface YoutubeVideoInfo {
    title: string
    thumbnail: string
    durationSeconds: number
    author: string
    url: string
    formats: YoutubeFormatInfo[]
}

export interface YoutubeChannelVideoItem {
    id: string
    title: string
    url: string
    thumbnail: string
    durationSeconds: number
    author: string
}

export interface YoutubeChannelInfo {
    id: string
    title: string
    author: string
    totalVideos: number
    videos: YoutubeChannelVideoItem[]
    hasMore: boolean
    nextPage: number
}

export interface DownloadOptions {
    url: string
    savePath: string
    qualityItag?: number
    height?: number
    rootDownloadDir?: string
    downloadThumbnail?: boolean
}

export interface DownloadChannelOptions {
    channelUrl: string
    saveDir: string
    qualityHeight?: number
    isAudioOnly?: boolean
    isThumbnail?: boolean
    downloadThumbnail?: boolean
    rootDownloadDir?: string
}

export interface ChannelProgressEvent {
    currentItem: number
    totalItems: number
    percent: number
    videoTitle?: string
    status: 'downloading' | 'completed' | 'cancelled' | 'error'
}

export interface ActiveDownloadState {
    isDownloading: boolean
    downloadType: 'video' | 'channel' | null
    url: string | null
    progress: {
        downloadedBytes: number
        totalBytes: number
        percent: number
    } | null
    channelProgress: ChannelProgressEvent | null
}
