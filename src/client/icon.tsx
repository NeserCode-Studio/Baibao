/**
 * The 百宝 brand glyph: a small robot head with a spark antenna.
 *
 * The head and eyes carry the AI reading at 16px; the spark on the antenna is
 * the light. It is intentionally geometric rather than cartoonish so it still
 * looks at home in the DSH sidebar.
 *
 * Colour comes from `currentColor` alone — the sidebar paints panel icons with
 * the row's own colour, and the shell switches that colour between themes and
 * between expanded and collapsed states. The outline is a single 16-unit set
 * so the shape survives the 16px sidebar row and scales up unchanged for the
 * larger empty state.
 */
export interface BaibaoIconProps {
  /** Square edge in pixels. */
  size?: number
  /** Whether the sidebar row is the selected panel (kept for contract parity). */
  active?: boolean
}

export function BaibaoIcon({ size = 16 }: BaibaoIconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="3.4"
        y="5.4"
        width="9.2"
        height="7.6"
        rx="2.4"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="6.2" cy="9" r="1.05" fill="currentColor" />
      <circle cx="9.8" cy="9" r="1.05" fill="currentColor" />
      <path d="M6.4 11.1h3.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M8 5.4V3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M8 1.1c.18.75.65 1.22 1.4 1.4-.75.18-1.22.65-1.4 1.4-.18-.75-.65-1.22-1.4-1.4.75-.18 1.22-.65 1.4-1.4Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Compact sliders glyph for the chat header's settings action. */
export function SettingsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.5 5.25h11M2.5 10.75h11"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <circle cx="6" cy="5.25" r="1.6" fill="currentColor" />
      <circle cx="10" cy="10.75" r="1.6" fill="currentColor" />
    </svg>
  )
}

/** Back chevron for leaving the settings panel. */
export function BackIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9.75 3.5 5.25 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
