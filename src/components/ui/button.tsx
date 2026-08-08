import { cn } from '#/lib/utils'

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant
    size?: ButtonSize
    block?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
    default:
        'border-border bg-surface text-foreground hover:bg-accent hover:border-border-strong border shadow-[0_1px_1px_rgb(0_0_0/0.03)]',
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
    danger: 'border-danger/25 text-danger hover:bg-danger/8 border',
}

const SIZES: Record<ButtonSize, string> = {
    sm: 'h-7 gap-1.5 px-2 text-xs [&_svg]:size-3.5',
    md: 'h-8.5 gap-2 px-2.5 text-[13px] [&_svg]:size-4',
}

export function Button({
    variant = 'default',
    size = 'md',
    block,
    className,
    type = 'button',
    ...props
}: ButtonProps) {
    return (
        <button
            type={type}
            className={cn(
                'focus-visible:ring-ring/50 inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
                VARIANTS[variant],
                SIZES[size],
                block && 'w-full',
                className,
            )}
            {...props}
        />
    )
}
