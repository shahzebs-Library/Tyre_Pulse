/**
 * casing — tyre casing/carcass: concentric ring layers of the tyre body ready
 * for retreading. Registered as `casing`.
 */
import IconBase from './IconBase'

export default function CasingIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  )
}
