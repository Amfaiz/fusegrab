export type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error'

export type UpdateAssetKind = 'windows-installer' | 'mac-dmg'

export type UpdateState = {
    status: UpdateStatus
    /** Latest available version (without the leading "v"), or null. */
    version: string | null
    notes: string | null
    percent: number
    /** Bytes downloaded so far. */
    transferred: number
    /** Total bytes of the installer. */
    total: number
    /** The platform-specific installer asset currently selected. */
    assetKind: UpdateAssetKind | null
    error: string | null
}

export type ReleaseAsset = {
    name: string
    browser_download_url: string
    size: number
}

export type Release = {
    tag_name: string
    name: string | null
    body: string | null
    assets: ReleaseAsset[]
}
