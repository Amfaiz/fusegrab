import * as React from 'react'

import { Tooltip as Base } from '@base-ui-components/react/tooltip'

import { cn } from '#/lib/utils'

/* ─── Primitives re-exported from Base UI ─── */
export const TooltipProvider = Base.Provider
export const Tooltip = Base.Root
export const TooltipTrigger = Base.Trigger
export const TooltipPortal = Base.Portal
export const TooltipPositioner = Base.Positioner
export const TooltipArrow = Base.Arrow

/* ─── TooltipContent ─── */
export interface TooltipContentProps extends React.ComponentPropsWithoutRef<
    typeof Base.Popup
> {
    sideOffset?: number
    align?: 'start' | 'center' | 'end'
    side?: 'top' | 'bottom' | 'left' | 'right' | 'inline-start' | 'inline-end'
    collisionPadding?: number
    positionerClassName?: string
    container?: React.ComponentProps<typeof Base.Portal>['container']
    showArrow?: boolean
}

export const TooltipContent = React.forwardRef<
    HTMLDivElement,
    TooltipContentProps
>(
    (
        {
            className,
            sideOffset = 6,
            align = 'center',
            side = 'top',
            collisionPadding = 8,
            positionerClassName,
            container,
            showArrow = true,
            children,
            ...props
        },
        ref,
    ) => (
        <Base.Portal container={container}>
            <Base.Positioner
                sideOffset={sideOffset}
                align={align}
                side={side}
                collisionPadding={collisionPadding}
                className={cn('z-50 outline-none', positionerClassName)}
            >
                <Base.Popup
                    ref={ref}
                    className={cn(
                        'border-border bg-background text-foreground max-w-xs origin-(--transform-origin) rounded-lg border px-3 py-2 text-xs shadow-lg transition-[transform,opacity] duration-150 outline-none select-none',
                        'data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0',
                        className,
                    )}
                    {...props}
                >
                    {children}
                    {showArrow && (
                        <Base.Arrow className="border-border bg-background size-2.5 rotate-45 data-[side=bottom]:-top-1.5 data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=left]:-right-1.5 data-[side=left]:border-t data-[side=left]:border-r data-[side=right]:-left-1.5 data-[side=right]:border-b data-[side=right]:border-l data-[side=top]:-bottom-1.5 data-[side=top]:border-r data-[side=top]:border-b" />
                    )}
                </Base.Popup>
            </Base.Positioner>
        </Base.Portal>
    ),
)
TooltipContent.displayName = 'TooltipContent'

/* ─── Simple Floating Box Helper ─── */
export type SimpleTooltipProps = {
    children: React.ReactNode
    content: React.ReactNode
    side?: 'top' | 'bottom' | 'left' | 'right'
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    className?: string
}

export function SimpleTooltip({
    children,
    content,
    side = 'top',
    align = 'center',
    sideOffset = 6,
    open,
    defaultOpen,
    onOpenChange,
    className,
}: SimpleTooltipProps) {
    return (
        <Tooltip
            open={open}
            defaultOpen={defaultOpen}
            onOpenChange={onOpenChange}
        >
            <TooltipTrigger
                delay={0}
                render={<span className="inline-flex max-w-full" />}
            >
                {children}
            </TooltipTrigger>
            <TooltipContent
                side={side}
                align={align}
                sideOffset={sideOffset}
                className={className}
            >
                {content}
            </TooltipContent>
        </Tooltip>
    )
}
