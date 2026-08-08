import * as React from 'react'

import { Select as Base } from '@base-ui/react/select'

import { Check } from '#/components/icons'
import { cn } from '#/lib/utils'

/* ─── Primitives re-exported from Base UI ─── */
export const Select = Base.Root
export const SelectValue = Base.Value
export const SelectIcon = Base.Icon
export const SelectPortal = Base.Portal
export const SelectPositioner = Base.Positioner
export const SelectItemText = Base.ItemText
export const SelectItemIndicator = Base.ItemIndicator
export const SelectGroup = Base.Group
export const SelectGroupLabel = Base.GroupLabel

/* ─── SelectTrigger ─── */
export const SelectTrigger = React.forwardRef<
    HTMLButtonElement,
    React.ComponentPropsWithoutRef<typeof Base.Trigger>
>(({ className, children, ...props }, ref) => (
    <Base.Trigger
        ref={ref}
        className={cn(
            'border-border bg-surface text-foreground hover:border-border-strong focus-visible:ring-ring/50 data-popup-open:border-border-strong flex h-8.5 w-full items-center gap-2 rounded-md border px-2.5 text-left text-xs shadow-[0_1px_1px_rgb(0_0_0/0.03)] transition-[border-color,box-shadow] outline-none focus-visible:ring-2 data-disabled:pointer-events-none data-disabled:opacity-50',
            className,
        )}
        {...props}
    >
        {children}
    </Base.Trigger>
))
SelectTrigger.displayName = 'SelectTrigger'

/* ─── SelectContent ─── */
export interface SelectContentProps extends React.ComponentPropsWithoutRef<
    typeof Base.Popup
> {
    sideOffset?: number
    align?: 'start' | 'center' | 'end'
}

export const SelectContent = React.forwardRef<
    HTMLDivElement,
    SelectContentProps
>(({ className, sideOffset = 4, align = 'start', children, ...props }, ref) => (
    <Base.Portal>
        <Base.Positioner
            sideOffset={sideOffset}
            align={align}
            alignItemWithTrigger={false}
            className="z-50 outline-none"
        >
            <Base.Popup
                ref={ref}
                className={cn(
                    'border-border bg-popover text-foreground z-50 max-h-[min(22rem,var(--available-height))] w-36 min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-lg border p-1 shadow-xl transition-[opacity,transform] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
                    className,
                )}
                {...props}
            >
                <Base.List className="max-h-[inherit] overflow-y-auto">
                    {children}
                </Base.List>
            </Base.Popup>
        </Base.Positioner>
    </Base.Portal>
))
SelectContent.displayName = 'SelectContent'

/* ─── SelectItem ─── */
export const SelectItem = React.forwardRef<
    HTMLDivElement,
    React.ComponentPropsWithoutRef<typeof Base.Item>
>(({ className, children, ...props }, ref) => (
    <Base.Item
        ref={ref}
        className={cn(
            'text-foreground data-highlighted:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-40',
            className,
        )}
        {...props}
    >
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            {children}
        </span>
        <Base.ItemIndicator className="shrink-0">
            <Check className="size-3.5" />
        </Base.ItemIndicator>
    </Base.Item>
))
SelectItem.displayName = 'SelectItem'
