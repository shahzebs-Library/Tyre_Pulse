/**
 * tyre — canonical example icon. Copy this pattern: a 24×24 stroke icon on
 * IconBase, currentColor, no fills, consistent stroke. Registered as `tyre`.
 */
import IconBase from './IconBase'

export default function TyreIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      {/* tread ticks */}
      <path d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3 5.6 5.6" />
    </IconBase>
  )
}
