/**
 * The 百宝 brand glyph: a domed treasure chest with a strap and hasp.
 *
 * The chest is the name's mascot, not a bookmark metaphor: it is the avatar
 * that identifies the agent in the sidebar and in the chat empty state.
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
      {/* Domed lid; its closing line is the chest's seam. */}
      <path
        d="M2.6 7.35a5.4 3.9 0 0 1 10.8 0Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      {/* Body: sides and bottom only, so the seam is drawn once. */}
      <path
        d="M2.6 7.35v4.05a1.9 1.9 0 0 0 1.9 1.9h7a1.9 1.9 0 0 0 1.9-1.9V7.35"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      {/* Strap over the lid, ending in the hasp that closes the chest. */}
      <rect x="7.35" y="5.05" width="1.3" height="3.2" rx="0.65" fill="currentColor" />
      <rect x="6.85" y="7.15" width="2.3" height="1.75" rx="0.55" fill="currentColor" />
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
