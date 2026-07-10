/**
 * <TpIcon> — render a registered custom Tyre Pulse icon by name. Inherits
 * `currentColor`, so it is theme-aware and stylable exactly like a Lucide icon.
 *
 *   import { TpIcon } from '@/components/icons'
 *   <TpIcon name="tyre" size={18} className="text-[var(--accent)]" />
 */
import { getIcon } from './registry'

export default function TpIcon({ name, fallback = null, ...props }) {
  const Cmp = getIcon(name)
  if (!Cmp) return fallback
  return <Cmp {...props} />
}
