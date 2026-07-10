/**
 * Illustration design tokens — the single source of colour + geometry for the
 * Tyre Pulse illustration system. Every value maps to a CSS variable defined in
 * index.css so illustrations automatically adapt to Light / Dark themes and to
 * per-tenant brand colours (--brand / --accent are overridden by TenantContext).
 *
 * Illustration components MUST reference these tokens (or `var(--…)` directly)
 * for any themed surface — never a hard-coded theme hex — so the artwork stays
 * legible on every background and in every tenant palette.
 */

/** Themed palette (all resolve to CSS variables with sensible fallbacks). */
export const C = Object.freeze({
  // Brand / accent — tinted per tenant by TenantContext.
  brand:        'var(--brand, #16a34a)',
  brandBright:  'var(--brand-bright, #22c55e)',
  brandElectric:'var(--brand-electric, #4ade80)',
  accent:       'var(--accent, #16a34a)',
  accentStrong: 'var(--accent-strong, #22c55e)',

  // Neutron surfaces / ink — flip between light & dark themes.
  ink:          'var(--text-primary, #101828)',
  sub:          'var(--text-secondary, #344054)',
  muted:        'var(--text-muted, #667085)',
  dim:          'var(--text-dim, #98a2b3)',
  surface:      'var(--surface-raised, #ffffff)',
  line:         'var(--border-bright, #d3d9e2)',
  lineSoft:     'var(--border-dim, #eaedf1)',

  // Semantic states.
  danger:       'var(--danger, #ef4444)',
  warning:      'var(--warning, #f59e0b)',
  success:      'var(--brand-bright, #22c55e)',
  info:         'var(--accent, #16a34a)',
})

/** Shared geometry so every illustration feels part of one system. */
export const G = Object.freeze({
  stroke: 3,          // consistent stroke width
  strokeThin: 2,
  radius: 10,         // consistent corner radius
  radiusSm: 6,
})

/** Default viewBox (4:3) — override per illustration when a shape needs it. */
export const DEFAULT_VIEWBOX = '0 0 240 180'
