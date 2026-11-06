/**
 * shadcn/ui switch, built on Radix.
 *
 * Used instead of a checkbox for on/off settings: a switch reads as "this is
 * currently on" at a glance, where a checkbox reads as "select this".
 *
 * Contrast needed help here. The shell's border token is 14% of the foreground
 * and the track was drawn with it, while the thumb is pure white — the two
 * disappeared into each other and the control looked like an empty box. The
 * track now uses its own darker mix, and the thumb carries a border so it stays
 * visible against any of the panel's surfaces.
 */
import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'
import { cn } from './cn'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5',
        'transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-foreground data-[state=unchecked]:bg-[color:var(--bb-track)]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full border border-border bg-background shadow-sm',
          'transition-transform',
          'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
