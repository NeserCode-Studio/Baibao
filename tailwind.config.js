/**
 * Tailwind for a plugin whose UI is embedded inside the DSH shell.
 *
 * Three settings exist to keep this stylesheet from leaking into the host:
 *
 * - `preflight: false` — Tailwind's base reset restyles bare `button`, `input`,
 *   `h1` and friends page-wide. Inside an embedded panel that would deform the
 *   shell's own controls.
 * - class names stay unprefixed so shadcn component sources can be dropped in
 *   unchanged; safety comes from the scope, not from renaming every utility.
 * - `important: '.bb-root'` — every generated rule is scoped under the panel's
 *   root element, so a stray selector cannot reach outside it.
 *
 * Colours resolve through `--bb-*` variables declared in `tailwind.css`, which
 * are themselves aliases of the shell's `--dsw-alias-*` tokens. Hard-coding hex
 * values here would break the moment the shell switches theme.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/client/**/*.{ts,tsx}'],
  important: '.bb-root',
  corePlugins: {
    preflight: true,
  },
  theme: {
    extend: {
      colors: {
        background: 'var(--bb-background)',
        foreground: 'var(--bb-foreground)',
        surface: 'var(--bb-surface)',
        border: 'var(--bb-border)',
        muted: {
          DEFAULT: 'var(--bb-muted)',
          foreground: 'var(--bb-muted-foreground)',
        },
        primary: {
          DEFAULT: 'var(--bb-primary)',
          foreground: 'var(--bb-primary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--bb-destructive)',
          foreground: 'var(--bb-destructive-foreground)',
        },
        accent: {
          DEFAULT: 'var(--bb-accent)',
          foreground: 'var(--bb-accent-foreground)',
        },
      },
      borderRadius: {
        card: '10px',
        input: '8px',
      },
      ringColor: {
        DEFAULT: 'var(--bb-ring)',
      },
      ringOffsetColor: {
        DEFAULT: 'var(--bb-background)',
      },
    },
  },
  plugins: [],
}
