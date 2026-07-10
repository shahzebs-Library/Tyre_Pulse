/**
 * puncture — a tyre pierced by a nail/spike. Registered as `puncture`.
 */
import IconBase from './IconBase'

export default function PunctureIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="13" r="8" />
      <circle cx="11" cy="13" r="3" />
      {/* nail piercing the crown */}
      <path d="M14.5 9.5 20 4" />
      {/* nail head */}
      <path d="M18.5 2.5 21.5 5.5" />
      {/* puncture escaping air marks */}
      <path d="M13 12l1.5-1.5" />
    </IconBase>
  )
}
