import * as React from 'react'

import { Switch as BaseSwitch } from '@base-ui/react/switch'

import { cn } from '#/lib/utils'

export type SwitchRootProps = React.ComponentPropsWithoutRef<
    typeof BaseSwitch.Root
>
export type SwitchThumbProps = React.ComponentPropsWithoutRef<
    typeof BaseSwitch.Thumb
>

export function SwitchRoot({ className, ...props }: SwitchRootProps) {
    return (
        <BaseSwitch.Root
            className={cn(
                'group focus-visible:ring-ring/50 data-checked:bg-primary data-unchecked:bg-muted-foreground/25 inline-flex h-4.5 w-7.5 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 outline-none focus-visible:ring-2 data-disabled:cursor-not-allowed data-disabled:opacity-50',
                className,
            )}
            {...props}
        />
    )
}

export function SwitchThumb({ className, ...props }: SwitchThumbProps) {
    return (
        <BaseSwitch.Thumb
            className={cn(
                'pointer-events-none block size-3.5 rounded-full bg-white shadow-xs transition-transform duration-200 ease-in-out data-checked:translate-x-3 data-unchecked:translate-x-0',
                className,
            )}
            {...props}
        />
    )
}

export type SwitchProps = Omit<SwitchRootProps, 'children'> & {
    thumbProps?: SwitchThumbProps
}

export function Switch({ className, thumbProps, ...props }: SwitchProps) {
    return (
        <SwitchRoot className={className} {...props}>
            <SwitchThumb {...thumbProps} />
        </SwitchRoot>
    )
}
