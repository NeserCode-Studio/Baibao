/**
 * Tailwind theme for the panel.
 *
 * The colour names are shadcn's own (`primary`, `input`, `ring`, `card`, …) so
 * component sources can be used verbatim. Values alias the shell's tokens, with
 * literal fallbacks because several of those tokens are unusable here: the three
 * surface layers all resolve to `#fff` and the border token is 4% alpha.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/client/**/*.{ts,tsx}'],
  important: '.bb-root',
  corePlugins: {
    // Stays on: it initialises the `--tw-*` properties that transform and shadow
    // utilities read. `important` scopes it to `.bb-root`, so the host is safe.
    preflight: true,
  },
  theme: {
    extend: {
      colors: {
        background: 'var(--bb-background)',
        foreground: 'var(--bb-foreground)',
        card: {
          DEFAULT: 'var(--bb-card)',
          foreground: 'var(--bb-card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--bb-popover)',
          foreground: 'var(--bb-popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--bb-primary)',
          foreground: 'var(--bb-primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--bb-secondary)',
          foreground: 'var(--bb-secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--bb-muted)',
          foreground: 'var(--bb-muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--bb-accent)',
          foreground: 'var(--bb-accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--bb-destructive)',
          foreground: 'var(--bb-destructive-foreground)',
        },
        border: 'var(--bb-border)',
        input: 'var(--bb-input)',
        ring: 'var(--bb-ring)',
      },
      borderRadius: {
        lg: 'var(--bb-radius)',
        md: 'calc(var(--bb-radius) - 2px)',
        sm: 'calc(var(--bb-radius) - 4px)',
      },
    },
  },
  plugins: [],
}
