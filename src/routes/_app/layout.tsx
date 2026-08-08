import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
    component: Layout,
})

function Layout() {
    return (
        <div className="bg-background flex h-full w-full flex-col overflow-hidden">
            <main className="min-w-0 flex-1 overflow-hidden">
                <Outlet />
            </main>
        </div>
    )
}
