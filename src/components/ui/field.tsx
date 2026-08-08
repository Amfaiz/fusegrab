import { Field as Base } from '@base-ui/react/field'

import { cn } from '#/lib/utils'

type FieldProps = {
    label: string
    /**
     * Short value readout pinned to the right of the control — a slider's
     * current reading, say. Sized for a few characters, not a sentence.
     */
    hint?: React.ReactNode
    children: React.ReactNode
    className?: string
}

/**
 * One property per row: label on the left, control on the right, all controls
 * sharing a left edge down the panel. The fixed label column is what buys that
 * alignment, so labels need to stay short enough to fit on one line.
 */
export function Field({ label, hint, children, className }: FieldProps) {
    return (
        <Base.Root
            className={cn(
                'flex min-h-8.5 min-w-0 items-center gap-3',
                className,
            )}
        >
            <Base.Label className="text-foreground/85 w-24 shrink-0 text-xs font-medium">
                {label}
            </Base.Label>
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center">
                    {children}
                </div>
                {hint != null && (
                    <span className="text-muted-foreground w-10 shrink-0 text-right font-mono text-[11px] whitespace-nowrap">
                        {hint}
                    </span>
                )}
            </div>
        </Base.Root>
    )
}

export function SectionTitle({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    return (
        <h2
            className={cn(
                'text-muted-foreground text-[11px] font-semibold tracking-wide uppercase',
                className,
            )}
        >
            {children}
        </h2>
    )
}
