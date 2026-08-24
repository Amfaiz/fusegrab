import * as React from 'react'

import { Input as BaseInput } from '@base-ui/react/input'

import { cn } from '#/lib/utils'

/* ─── InputRoot: wrapper for icon + input combos ─── */
export const InputRoot = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            'border-border bg-surface hover:border-border-strong focus-within:border-border-strong focus-within:ring-ring/40 flex h-8.5 w-full min-w-0 items-center gap-2 rounded-md border px-2.5 shadow-[0_1px_1px_rgb(0_0_0/0.03)] transition-[border-color,box-shadow] focus-within:ring-2',
            className,
        )}
        {...props}
    />
)
InputRoot.displayName = 'InputRoot'

/* ─── InputIcon: leading icon inside InputRoot ─── */
export const InputIcon = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
    <span
        className={cn(
            'text-muted-foreground/70 flex shrink-0 items-center [&_svg]:size-3.5',
            className,
        )}
        {...props}
    />
)
InputIcon.displayName = 'InputIcon'

/* ─── Input: the text field itself ─── */
export type InputProps = React.ComponentPropsWithoutRef<typeof BaseInput> & {
    /** Monospaced + tabular, for timecodes and other figures. */
    numeric?: boolean
}

export function Input({ className, numeric, ...props }: InputProps) {
    return (
        <BaseInput
            className={cn(
                'border-border bg-surface text-foreground placeholder:text-muted-foreground/70 hover:border-border-strong focus:border-border-strong focus:ring-ring/40 h-8.5 w-full min-w-0 rounded-md border px-2.5 text-[13px] shadow-[0_1px_1px_rgb(0_0_0/0.03)] transition-[border-color,box-shadow] outline-none focus:ring-2 disabled:pointer-events-none disabled:opacity-50',
                numeric && 'font-mono',
                className,
            )}
            {...props}
        />
    )
}

/* ─── Bare input (no border/bg, for use inside InputRoot) ─── */
export type InputFieldProps = React.ComponentPropsWithoutRef<
    typeof BaseInput
> & {
    numeric?: boolean
}

export const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(
    ({ className, numeric, ...props }, ref) => (
        <BaseInput
            ref={ref}
            className={cn(
                'text-foreground placeholder:text-muted-foreground/70 w-full min-w-0 bg-transparent text-[13px] outline-none disabled:pointer-events-none disabled:opacity-50',
                numeric && 'font-mono',
                className,
            )}
            {...props}
        />
    ),
)
InputField.displayName = 'InputField'

/* ─── Textarea ─── */
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, ...props }, ref) => (
        <textarea
            ref={ref}
            className={cn(
                'border-border bg-surface text-foreground placeholder:text-muted-foreground/70 hover:border-border-strong focus:border-border-strong focus:ring-ring/40 w-full min-w-0 resize-none rounded-md border p-2.5 text-[13px] shadow-[0_1px_1px_rgb(0_0_0/0.03)] transition-[border-color,box-shadow] outline-none focus:ring-2 disabled:pointer-events-none disabled:opacity-50',
                className,
            )}
            {...props}
        />
    ),
)
Textarea.displayName = 'Textarea'
