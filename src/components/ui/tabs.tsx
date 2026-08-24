import { Tabs as Base } from '@base-ui-components/react/tabs'

import { cn } from '#/lib/utils'

export const Tabs = Base.Root

export function TabList({
    className,
    children,
}: {
    className?: string
    children: React.ReactNode
}) {
    return (
        <Base.List
            className={cn(
                'border-border relative flex shrink-0 gap-4 border-b px-4',
                className,
            )}
        >
            {children}
            {/* Sits under the active tab and slides between them. */}
            <Base.Indicator className="bg-foreground absolute bottom-0 left-0 z-10 h-[1.5px] w-(--active-tab-width) translate-x-(--active-tab-left) rounded-full transition-[translate,width] duration-200 ease-out" />
        </Base.List>
    )
}

export function Tab({
    value,
    children,
    className,
}: {
    value: string
    children: React.ReactNode
    className?: string
}) {
    return (
        <Base.Tab
            value={value}
            className={cn(
                // h-10 matches the tool header in the main column, so the two
                // bottom borders read as one line across the window.
                'text-muted-foreground focus-visible:ring-ring/50 relative -mb-px flex h-10 cursor-pointer items-center rounded-sm text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2',
                'hover:text-foreground data-selected:text-foreground',
                className,
            )}
        >
            {children}
        </Base.Tab>
    )
}

export function TabPanel({
    value,
    className,
    children,
}: {
    value: string
    className?: string
    children: React.ReactNode
}) {
    return (
        <Base.Panel
            value={value}
            className={cn('min-h-0 flex-1 outline-none', className)}
        >
            {children}
        </Base.Panel>
    )
}
