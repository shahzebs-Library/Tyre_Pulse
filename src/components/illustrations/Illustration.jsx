/**
 * <Illustration> — render a registered Tyre Pulse illustration by name.
 * Falls back gracefully (renders nothing) when the name is unknown, so a
 * missing asset never crashes a screen.
 *
 *   <Illustration name="state/no-data" size={220} title="No inspections yet" />
 */
import { getIllustration } from './registry'

export default function Illustration({ name, fallback = null, ...props }) {
  const Cmp = getIllustration(name)
  if (!Cmp) return fallback
  return <Cmp {...props} />
}
