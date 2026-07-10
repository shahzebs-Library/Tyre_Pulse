/**
 * Tyre Pulse custom icon set — public entry point. A domain-specific stroke-icon
 * family that complements Lucide (tyres, treads, axles, fleet, workshop, KPIs …).
 *
 *   import { TpIcon } from '@/components/icons'
 *   <TpIcon name="tread-depth" size={20} />
 *
 * Add an icon by dropping a `*.icon.jsx` file here (see _CONTRACT.md); the
 * registry discovers it automatically.
 */
export { default as TpIcon } from './Icon'
export { default as IconBase, ICON_STROKE } from './IconBase'
export { ICONS, ICON_NAMES, getIcon, hasIcon } from './registry'
