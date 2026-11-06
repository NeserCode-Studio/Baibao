/**
 * shadcn/ui card.
 *
 * The surface token is this panel's own tinted layer rather than shadcn's
 * `--card`: the shell's three surface tokens all resolve to the same white, so a
 * card drawn on `bg-card` would have no edge against the page. Elevation here is
 * carried by the border and a one-pixel shadow, not by a colour difference.
 */
import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-muted text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-start justify-between gap-3 p-4 pb-0', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-[13px] font-semibold leading-tight tracking-tight', className)} {...props} />
  )
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-[11px] leading-relaxed text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-3.5', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2 px-4 pb-4', className)} {...props} />
}
