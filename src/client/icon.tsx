/**
 * The 百宝 brand glyph: a four-point spark joined to two network nodes.
 *
 * The spark is the "light"; the nodes and the short links are the "AI" side.
 * Together they read as a small constellation rather than a literal book or
 * treasure chest.
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
      {/* Light: a four-point spark. */}
      <path
        d="M8 2.5c.5 2.6 2.6 4.7 5.2 5.2-2.6.5-4.7 2.6-5.2 5.2-.5-2.6-2.6-4.7-5.2-5.2C5.4 7.2 7.5 5.1 8 2.5Z"
        fill="currentColor"
      />
      {/* AI: two nodes joined to the spark. */}
      <path
        d="M3.2 3.2 4.7 4.7M12.8 12.8l-1.5-1.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle cx="2.3" cy="2.3" r="1" fill="currentColor" />
      <circle cx="13.7" cy="13.7" r="1" fill="currentColor" />
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
