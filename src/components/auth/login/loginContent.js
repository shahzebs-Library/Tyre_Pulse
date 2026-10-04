/**
 * Static content for the sign-in page hero. Presentation only: every label is
 * an i18n key under auth.login.page.*, every photo is a self-hosted file under
 * public/login-art/ (brand badges blurred or cropped out before publishing).
 */
import {
  HardHat, Mountain, Fuel, Truck, Factory, Landmark, Ship,
  Disc3, Wrench, Gauge, Boxes, Users, BarChart3,
} from 'lucide-react'

/** The public marketing site. Nav and contact links point here. */
export const MARKETING_URL = 'https://tyre-pulse-eezl.vercel.app'

export const NAV_LINKS = [
  { key: 'industries', path: '/industries' },
  { key: 'solutions', path: '/platform' },
  { key: 'modules', path: '/platform/fleet-assets' },
  { key: 'security', path: '/security' },
  { key: 'support', path: '/contact' },
]

export const INDUSTRIES = [
  { key: 'construction', icon: HardHat, photo: '/login-art/industry-construction.webp' },
  { key: 'mining', icon: Mountain, photo: '/login-art/industry-mining.webp' },
  { key: 'oilGas', icon: Fuel, photo: '/login-art/industry-oilgas.webp' },
  { key: 'logistics', icon: Truck, photo: '/login-art/industry-logistics.webp' },
  { key: 'concrete', icon: Factory, photo: '/login-art/industry-concrete.webp' },
  { key: 'government', icon: Landmark, photo: '/login-art/industry-government.webp' },
  { key: 'ports', icon: Ship, photo: '/login-art/industry-ports.webp' },
]

export const CAPABILITIES = [
  { key: 'tyres', icon: Disc3 },
  { key: 'maintenance', icon: Wrench },
  { key: 'operations', icon: Gauge },
  { key: 'assets', icon: Boxes },
  { key: 'people', icon: Users },
  { key: 'reports', icon: BarChart3 },
]

/** Exact count with thousands separators, or null when not measured. */
export function formatCount(n, locale = 'en') {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(Number(n))
  } catch {
    return String(n)
  }
}

export const REMEMBER_KEY = 'tp_login_remember_id'

export function readRememberedId() {
  try { return localStorage.getItem(REMEMBER_KEY) || '' } catch { return '' }
}

export function writeRememberedId(value) {
  try {
    if (value) localStorage.setItem(REMEMBER_KEY, value)
    else localStorage.removeItem(REMEMBER_KEY)
  } catch { /* storage unavailable: remembering is a convenience only */ }
}
