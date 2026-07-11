/**
 * Brand logo library — the curated set of Tyre Pulse logo variants that ship
 * with the app, plus the placement-slot registry and the resolver used by every
 * render site (app chrome, login, favicon, reports, email, mobile).
 *
 * The optimised, transparent-background PNGs live in `public/brand/library/`
 * and are described by `library.generated.json` (produced from the source art
 * with real dimensions + byte sizes). Assets are served statically and loaded
 * on demand — they are never bundled into the JS payload.
 *
 * A placement value stored in `organisations.settings->branding->logos[slot]`
 * may be one of:
 *   • a library asset id   (e.g. "horizontal-classic")  → resolves to its PNG
 *   • an absolute URL       (https://…)                  → used as-is
 *   • a root-relative path  (/uploads/logo.png)          → used as-is
 * Anything else / empty resolves to `null`, so the caller falls back to the
 * built-in default mark and an unbranded org looks exactly as before.
 */
import generated from './library.generated.json'

/** Public URL prefix for the bundled library assets. */
export const BRAND_LOGO_BASE = '/brand/library'

/** All curated logo variants, sorted by id. */
export const BRAND_LOGOS = Object.freeze(generated)

/** Fast lookup: id → variant meta. */
export const BRAND_LOGO_BY_ID = Object.freeze(
  Object.fromEntries(generated.map((l) => [l.id, l])),
)

/** Distinct colourways present in the library (for gallery filters). */
export const BRAND_LOGO_COLORS = Object.freeze(
  [...new Set(generated.map((l) => l.color))].sort(),
)

/** Distinct layouts present in the library (for gallery filters). */
export const BRAND_LOGO_LAYOUTS = Object.freeze(
  [...new Set(generated.map((l) => l.layout))].sort(),
)

/**
 * Placement slots an admin can assign a logo to. `surface` documents the
 * background the logo renders on so the picker can steer users to a legible
 * variant. `recommend` lists the layouts that suit the slot best.
 */
export const LOGO_SLOTS = Object.freeze([
  { key: 'app_icon',     label: 'App Icon (Header & Sidebar)', surface: 'dark',  hint: 'Small square mark shown top-left and in the collapsed nav.', recommend: ['icon', 'stacked'] },
  { key: 'login',        label: 'Login Screen',                surface: 'dark',  hint: 'Logo on the sign-in page. Applies after the first sign-in on this device.', recommend: ['horizontal', 'stacked'] },
  { key: 'favicon',      label: 'Browser Tab (Favicon)',       surface: 'any',   hint: 'Icon in the browser tab. Applies after sign-in.', recommend: ['icon'] },
  { key: 'report_cover', label: 'Report Cover (PDF / PPTX)',   surface: 'light', hint: 'Logo on generated report covers. Also drives the report logo URL.', recommend: ['horizontal', 'stacked'] },
  { key: 'email_header', label: 'Email Header',                surface: 'light', hint: 'Logo at the top of emailed reports.', recommend: ['horizontal'] },
  { key: 'mobile_splash',label: 'Mobile Splash',               surface: 'light', hint: 'Logo on the mobile app launch screen.', recommend: ['stacked', 'icon'] },
  { key: 'pdf_watermark',label: 'PDF Watermark',               surface: 'light', hint: 'Faint mark behind report pages.', recommend: ['icon', 'horizontal'] },
])

export const LOGO_SLOT_KEYS = Object.freeze(LOGO_SLOTS.map((s) => s.key))

/** Absolute public URL for a library asset id, or `null` if unknown. */
export function assetUrl(id) {
  const l = BRAND_LOGO_BY_ID[id]
  return l ? `${BRAND_LOGO_BASE}/${l.file}` : null
}

/** Is `v` an already-usable URL/path (vs a library asset id)? */
export function isUrlValue(v) {
  return typeof v === 'string' && /^(https?:\/\/|\/)/.test(v.trim())
}

/**
 * Resolve a raw placement value (asset id | URL | path) to a usable src.
 * Returns `null` when empty or an unknown asset id.
 */
export function resolveLogoValue(val) {
  if (typeof val !== 'string') return null
  const v = val.trim()
  if (!v) return null
  if (isUrlValue(v)) return v
  return assetUrl(v)
}

/** Resolve the logo assigned to `slot` in a branding object, or `null`. */
export function resolveBrandLogo(branding, slot) {
  return resolveLogoValue(branding?.logos?.[slot])
}

/* ── Pre-auth cache ────────────────────────────────────────────────────────
 * The login screen and favicon render before TenantContext knows the org.
 * After branding loads we cache the resolved slot URLs so a returning visitor
 * sees the org's branded login/favicon on their next visit. Cleared on logout.
 */
const LS_KEY = 'tp.brandLogos.v1'

export function cacheResolvedLogos(branding) {
  try {
    const out = {}
    for (const s of LOGO_SLOTS) {
      const u = resolveBrandLogo(branding, s.key)
      if (u) out[s.key] = u
    }
    if (Object.keys(out).length) localStorage.setItem(LS_KEY, JSON.stringify(out))
    else localStorage.removeItem(LS_KEY)
  } catch { /* storage unavailable — non-critical */ }
}

export function clearCachedLogos() {
  try { localStorage.removeItem(LS_KEY) } catch { /* noop */ }
}

export function readCachedLogo(slot) {
  try { return (JSON.parse(localStorage.getItem(LS_KEY) || '{}'))[slot] || null }
  catch { return null }
}
