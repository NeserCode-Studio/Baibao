/**
 * shadcn/ui switch, built on Radix.
 *
 * Used instead of a checkbox for on/off settings: a switch reads as "this is
 * currently on" at a glance, where a checkbox reads as "select this". The thumb
 * keeps a visible focus ring — a settings panel that hides focus is unusable by
 * keyboard.
 */
import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'
import { cn } from './cn'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full',
        'border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-foreground data-[state=unchecked]:bg-border',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform',
          'data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
