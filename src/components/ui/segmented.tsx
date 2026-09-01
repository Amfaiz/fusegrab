import { Toggle } from '@base-ui-components/react/toggle'
import { ToggleGroup } from '@base-ui-components/react/toggle-group'

import { SimpleTooltip } from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'

export type SegmentedOption<T extends string> = {
    value: T
    label: React.ReactNode
    title?: string
    disabled?: boolean
    tooltip?: React.ReactNode
}

type SegmentedProps<T extends string> = {
    value: T
    options: Array<SegmentedOption<T>>
    onValueChange: (value: T) => void
    disabled?: boolean
    className?: string
    'aria-label'?: string
}

/**
 * A single-choice segmented control. Built on ToggleGroup rather than radios so
 * arrow-key navigation moves between segments the way it does in native
 * platform equivalents.
 */
export function Segmented<T extends string>({
    value,
    options,
    onValueChange,
    disabled,
    className,
    'aria-label': ariaLabel,
}: SegmentedProps<T>) {
    return (
        <ToggleGroup
            aria-label={ariaLabel}
            disabled={disabled}
            value={[value]}
            onValueChange={(next) => {
                // An empty array means the pressed segment was toggled off; a
                // single choice always keeps one selected.
                const [chosen] = next
                if (chosen != null) onValueChange(chosen as T)
            }}
            className={cn(
                'bg-muted flex w-full gap-0.5 rounded-md p-0.5',
                className,
            )}
        >
            {options.map((option) => {
                const toggle = (
                    <Toggle
                        key={option.value}
                        value={option.value}
                        title={option.title}
                        disabled={option.disabled}
                        className={cn(
                            'text-muted-foreground focus-visible:ring-ring/50 flex h-7 min-w-0 flex-1 items-center justify-center rounded-[5px] px-1.5 text-xs font-medium transition-[background-color,color,box-shadow] outline-none focus-visible:ring-2',
                            'hover:text-foreground',
                            'data-pressed:bg-surface data-pressed:text-foreground data-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.06)]',
                            'disabled:opacity-40',
                            option.disabled &&
                                !option.tooltip &&
                                'disabled:pointer-events-none',
                            option.disabled && 'cursor-not-allowed',
                        )}
                    >
                        <span className="truncate">{option.label}</span>
                    </Toggle>
                )

                if (option.tooltip) {
                    return (
                        <SimpleTooltip
                            key={option.value}
                            content={option.tooltip}
                            side="top"
                            align="center"
                            className="max-w-xs text-center text-xs font-normal"
                        >
                            <span className="flex min-w-0 flex-1">
                                {toggle}
                            </span>
                        </SimpleTooltip>
                    )
                }

                return toggle
            })}
        </ToggleGroup>
    )
}
