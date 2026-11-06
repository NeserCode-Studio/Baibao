/**
 * shadcn/ui input, sized for the embedded panel.
 *
 * Labels are paired outside the component: the panel's forms are dense, and a
 * placeholder standing in for a label is the most common accessibility failure
 * in settings panels.
 */
import type { InputHTMLAttributes } from 'react'
import { cn } from './cn'

export function Input({ className, type = 'text', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        'h-7 w-full min-w-0 rounded-input border border-border bg-background px-2 text-body text-foreground',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
