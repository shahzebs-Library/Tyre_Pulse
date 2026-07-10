/**
 * tyre-rotation — a tyre encircled by rotation arrows. Registered as `tyre-rotation`.
 */
import IconBase from './IconBase'

export default function TyreRotationIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.75" />
      {/* rotation arc top */}
      <path d="M5 9a8 8 0 0 1 12.5-2" />
      <path d="M18 3v4h-4" />
      {/* rotation arc bottom */}
      <path d="M19 15a8 8 0 0 1-12.5 2" />
      <path d="M6 21v-4h4" />
    </IconBase>
  )
}
