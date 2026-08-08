import * as React from 'react'

import { Dialog as Base } from '@base-ui/react/dialog'

import { cn } from '#/lib/utils'

/* ─── Primitives re-exported from Base UI ─── */
export const Dialog = Base.Root
export const DialogTrigger = Base.Trigger
export const DialogClose = Base.Close
export const DialogPortal = Base.Portal

/* ─── Content (card + backdrop) ─── */
export interface DialogContentProps extends React.ComponentPropsWithoutRef<
    typeof Base.Popup
> {
    /** Max-width utility class override, defaults to `max-w-sm`. */
    maxWidth?: string
}

export const DialogContent = React.forwardRef<
    HTMLDivElement,
    DialogContentProps
>(({ className, children, maxWidth = 'max-w-sm', ...props }, ref) => (
    <Base.Portal>
        <Base.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <Base.Popup
                ref={ref}
                className={cn(
                    'bg-popover text-foreground border-border/40 relative z-50 w-full rounded-xl border shadow-xl transition-[opacity,transform] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
                    maxWidth,
                    className,
                )}
                {...props}
            >
                {children}
            </Base.Popup>
        </div>
    </Base.Portal>
))
DialogContent.displayName = 'DialogContent'

/* ─── Header: back‑button | title | close‑button ─── */
export const DialogHeader = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            'border-border mb-3 flex items-center justify-between gap-3 border-b py-2 pr-2 pl-4',
            className,
        )}
        {...props}
    />
)
DialogHeader.displayName = 'DialogHeader'

/* ─── Small icon button used for back / close ─── */
export const DialogIconButton = React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
    <button
        ref={ref}
        type="button"
        className={cn(
            'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex size-6 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2',
            className,
        )}
        {...props}
    />
))
DialogIconButton.displayName = 'DialogIconButton'

/* ─── Title (centered between the icon buttons) ─── */
export const DialogTitle = React.forwardRef<
    HTMLHeadingElement,
    React.ComponentPropsWithoutRef<typeof Base.Title>
>(({ className, ...props }, ref) => (
    <Base.Title
        ref={ref}
        className={cn(
            'text-foreground flex-1 text-sm font-semibold',
            className,
        )}
        {...props}
    />
))
DialogTitle.displayName = 'DialogTitle'

/* ─── Description (instruction text below header) ─── */
export const DialogDescription = React.forwardRef<
    HTMLParagraphElement,
    React.ComponentPropsWithoutRef<typeof Base.Description>
>(({ className, ...props }, ref) => (
    <Base.Description
        ref={ref}
        className={cn(
            'text-muted-foreground mb-2 px-4 text-[13px] leading-relaxed',
            className,
        )}
        {...props}
    />
))
DialogDescription.displayName = 'DialogDescription'

/* ─── Body (wraps inputs / content between description and footer) ─── */
export const DialogBody = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('flex flex-col gap-3 px-4', className)} {...props} />
)
DialogBody.displayName = 'DialogBody'

/* ─── Footer (full-width action button area) ─── */
export const DialogFooter = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('flex flex-col gap-2 p-4', className)} {...props} />
)
DialogFooter.displayName = 'DialogFooter'
