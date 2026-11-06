/**
 * shadcn/ui switch — the upstream component, with only the colours changed.
 *
 * The geometry is shadcn's verbatim: the track carries `border-2
 * border-transparent` (that transparent border *is* the inset), and the thumb
 * travels `translate-x-4` driven by its own `data-state`. An earlier version
 * substituted `p-0.5` and a hand-computed `translate-x-[18px]`, which is not the
 * same layout and did not move.
 *
 * Only two things differ from upstream:
 *
 * - the state colours, because this panel cannot borrow shadcn's `--primary` /
 *   `--input` — the shell's tokens give no usable track colour;
 * - the thumb is positioned from the root's `data-state` via `group`, not from
 *   its own. The track colour proved that `data-state` reaches the root, while
 *   the same attribute on the thumb drove nothing, so the knob stayed put and
 *   only the track changed.
 */
import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'
import { cn } from './cn'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'group peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-foreground data-[state=unchecked]:bg-[color:var(--bb-track)]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
          'translate-x-0 group-data-[state=checked]:translate-x-4',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
