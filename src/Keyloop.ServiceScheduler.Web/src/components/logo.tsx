// Adopted from shadcn-dashboard-landing-template (vite-version) `src/components/logo.tsx`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import * as React from "react"

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number
}

/**
 * The product glyph: bookings on three workshop lanes and the board's "now" line. Keyloop's own logo is never reproduced; the brand appears as the
 * "Keyloop" text wordmark next to this glyph.
 */
export function Logo({ size = 24, className, ...props }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <rect x="1.5" y="2.5" width="7" height="3" rx="0.75" />
      <rect x="6" y="6.5" width="8.5" height="3" rx="0.75" />
      <rect x="3" y="10.5" width="5.5" height="3" rx="0.75" opacity="0.6" />
      <rect x="11" y="1" width="1" height="14" rx="0.5" opacity="0.6" />
    </svg>
  )
}
