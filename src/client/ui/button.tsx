/**
 * shadcn/ui button, adapted for an embedded panel.
 *
 * The component body is shadcn's; what changed is the scale. The shell's panel is
 * compact (11–12px labels), so the default size is smaller than shadcn's and the
 * focus ring stays visible — an embedded panel that drops focus outlines makes
 * keyboard navigation unusable inside the host.
 */
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-input font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        // Foreground-on-background is self-inverting: in a dark theme the
        // foreground goes light and the label goes dark, with no separate token
        // to keep in sync.
        default: 'bg-foreground text-background hover:opacity-90',
        secondary: 'bg-muted text-foreground hover:bg-accent',
        outline: 'border border-border bg-transparent text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
      },
      size: {
        default: 'h-7 px-3 text-body',
        sm: 'h-6 px-2 text-label',
        icon: 'size-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Render as the child element, e.g. an anchor. */
    asChild?: boolean
  }

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button'
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { buttonVariants }
