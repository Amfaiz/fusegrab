import { Progress as Base } from '@base-ui/react/progress'

import { cn } from '#/lib/utils'

type ProgressBarProps = {
    /** 0–1, or null for work of unknown length. */
    value: number | null
    className?: string
}

export function ProgressBar({ value, className }: ProgressBarProps) {
    return (
        <Base.Root
            value={value == null ? null : Math.round(value * 100)}
            className={cn('w-full', className)}
        >
            <Base.Track className="bg-muted h-1 w-full overflow-hidden rounded-full">
                {value == null ? (
                    // Indeterminate: a short bar sweeping the track, rather than
                    // a full bar pulsing, which reads as "stuck".
                    <div className="bg-foreground/40 h-full w-1/3 animate-[progress-sweep_1.4s_ease-in-out_infinite] rounded-full" />
                ) : (
                    <Base.Indicator className="bg-primary h-full rounded-full transition-[width] duration-200 ease-out" />
                )}
            </Base.Track>
        </Base.Root>
    )
}
