import type { UpdateState } from '#/lib/services/updater/service'

import { useCallback, useEffect, useState } from 'react'

export function useUpdater() {
    const [state, setState] = useState<UpdateState | null>(null)
    const [currentVersion, setCurrentVersion] = useState('')

    useEffect(() => {
        let disposed = false
        const off = window.api.updater.onState((next) => {
            if (!disposed) setState(next)
        })
        // Subscribe before reading the snapshot so a state change in between
        // can't be missed.
        window.api.updater.getState().then((snapshot) => {
            if (!disposed) setState(snapshot)
        })
        window.api.updater.currentVersion().then((version) => {
            if (!disposed) setCurrentVersion(version)
        })
        return () => {
            disposed = true
            off()
        }
    }, [])

    const check = useCallback(() => window.api.updater.check(), [])
    const download = useCallback(() => window.api.updater.download(), [])
    const install = useCallback(() => window.api.updater.install(), [])

    return { state, currentVersion, check, download, install }
}
