import * as React from 'react'

import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'

import { Check, Minus } from '#/components/icons'
import { cn } from '#/lib/utils'

export type CheckboxRootProps = React.ComponentPropsWithoutRef<
    typeof BaseCheckbox.Root
>
export type CheckboxIndicatorProps = React.ComponentPropsWithoutRef<
    typeof BaseCheckbox.Indicator
>

export function CheckboxRoot({ className, ...props }: CheckboxRootProps) {
    return (
        <BaseCheckbox.Root
            className={cn(
                'border-border/80 bg-muted/40 focus-visible:ring-ring/50 data-checked:bg-primary data-checked:text-primary-foreground data-checked:border-primary data-indeterminate:text-foreground data-indeterminate:border-border peer flex size-4 shrink-0 items-center justify-center rounded border transition-colors outline-none focus-visible:ring-2 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-indeterminate:bg-transparent',
                className,
            )}
            {...props}
        />
    )
}

export function CheckboxIndicator({
    className,
    children,
    ...props
}: CheckboxIndicatorProps) {
    return (
        <BaseCheckbox.Indicator
            className={cn(
                'flex items-center justify-center text-current',
                className,
            )}
            {...props}
        >
            {children || (
                <>
                    <Check className="size-3 stroke-3 data-indeterminate:hidden" />
                    <Minus className="hidden size-3 stroke-3 data-indeterminate:block" />
                </>
            )}
        </BaseCheckbox.Indicator>
    )
}

export type CheckboxProps = Omit<CheckboxRootProps, 'children'> & {
    indicatorProps?: CheckboxIndicatorProps
}

export function Checkbox({
    className,
    indicatorProps,
    ...props
}: CheckboxProps) {
    return (
        <CheckboxRoot className={className} {...props}>
            <CheckboxIndicator {...indicatorProps} />
        </CheckboxRoot>
    )
}
