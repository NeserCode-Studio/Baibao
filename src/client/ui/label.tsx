/** shadcn/ui label, built on Radix so `htmlFor` and nesting both associate. */
import * as LabelPrimitive from '@radix-ui/react-label'
import type { ComponentProps } from 'react'
import { cn } from './cn'

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'block text-[11px] font-medium uppercase tracking-wide text-muted-foreground',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  )
}
