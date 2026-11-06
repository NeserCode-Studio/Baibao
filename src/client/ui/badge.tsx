/**
 * shadcn/ui badge, used for connection state.
 *
 * The dot is a separate element rather than a background colour: a filled pill
 * reads as a button and competes with the settings around it, while a dot plus a
 * word carries the same meaning quietly.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from './cn'

const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-background text-muted-foreground',
        success: 'bg-background text-muted-foreground',
        warning: 'bg-background text-muted-foreground',
        danger: 'bg-background text-muted-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

const dotTone: Record<string, string> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
}

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & {
    /** Colour of the leading dot. */
    tone?: 'neutral' | 'success' | 'warning' | 'danger'
  }

export function Badge({ className, tone = 'neutral', children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      <span className={cn('size-1.5 rounded-full', dotTone[tone ?? 'neutral'])} aria-hidden="true" />
      {children}
    </span>
  )
}
