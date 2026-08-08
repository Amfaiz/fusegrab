import { createFileRoute } from '@tanstack/react-router'

import { YoutubeDownloader } from './-components/downloader'

export const Route = createFileRoute('/_app/')({
    component: RouteComponent,
})

function RouteComponent() {
    return (
        <div className="flex h-full w-full flex-col overflow-hidden">
            <YoutubeDownloader />
        </div>
    )
}
