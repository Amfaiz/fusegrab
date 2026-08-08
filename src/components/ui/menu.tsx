import * as React from 'react'

import { Menu as Base } from '@base-ui/react/menu'

import { cn } from '#/lib/utils'

/* ─── Primitives re-exported from Base UI ─── */
export const Menu = Base.Root
export const MenuTrigger = Base.Trigger
export const MenuPortal = Base.Portal
export const MenuPositioner = Base.Positioner
export const MenuGroup = Base.Group
export const MenuGroupLabel = Base.GroupLabel

/* ─── MenuContent ─── */
export interface MenuContentProps extends React.ComponentPropsWithoutRef<
    typeof Base.Popup
> {
    sideOffset?: number
    align?: 'start' | 'center' | 'end'
}

export const MenuContent = React.forwardRef<HTMLDivElement, MenuContentProps>(
    ({ className, sideOffset = 4, align = 'end', children, ...props }, ref) => (
        <Base.Portal>
            <Base.Positioner
                sideOffset={sideOffset}
                align={align}
                className="z-50 outline-none"
            >
                <Base.Popup
                    ref={ref}
                    className={cn(
                        'border-border bg-popover text-foreground z-50 w-44 rounded-lg border p-1 shadow-xl transition-[opacity,transform] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
                        className,
                    )}
                    {...props}
                >
                    {children}
                </Base.Popup>
            </Base.Positioner>
        </Base.Portal>
    ),
)
MenuContent.displayName = 'MenuContent'

/* ─── MenuItem ─── */
export const MenuItem = React.forwardRef<
    HTMLDivElement,
    React.ComponentPropsWithoutRef<typeof Base.Item>
>(({ className, ...props }, ref) => (
    <Base.Item
        ref={ref}
        className={cn(
            'text-foreground hover:bg-muted focus:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-40',
            className,
        )}
        {...props}
    />
))
MenuItem.displayName = 'MenuItem'

/* ─── MenuSeparator ─── */
export const MenuSeparator = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('bg-border/60 -mx-1 my-1 h-px', className)} {...props} />
)
MenuSeparator.displayName = 'MenuSeparator'
