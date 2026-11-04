/**
 * The 百宝 brand glyph: a whale with a four-point spark for a spout.
 *
 * The whale is the DeepSeek motif; the spark is the light. The eye is a
 * negative-space hole so the silhouette survives at 16px without a second
 * colour.
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
      <path
        fillRule="evenodd"
        d="M2.4 8.4c0-2.2 2.2-3.9 4.9-3.9 1.6 0 3 .6 4 1.7l2.6-1.8-.5 2.4 1.5.9-2.5 1.1c-.8 2.2-2.9 3.6-5.3 3.6-2.9 0-5.2-1.8-5.2-4Zm3.1-1.1a.72.72 0 1 0 0 1.44.72.72 0 0 0 0-1.44Z"
        fill="currentColor"
      />
      <path
        d="M6.4 1.1c.2.95.85 1.6 1.8 1.8-.95.2-1.6.85-1.8 1.8-.2-.95-.85-1.6-1.8-1.8.95-.2 1.6-.85 1.8-1.8Z"
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
