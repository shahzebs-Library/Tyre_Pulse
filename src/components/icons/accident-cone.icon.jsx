/**
 * accident-cone — a traffic safety cone. Registered as `accident-cone`.
 */
import IconBase from './IconBase'

export default function AccidentConeIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M11 4.5h2l5 14.5H6z" />
      {/* base */}
      <path d="M4 19.5h16" />
      {/* reflective bands */}
      <path d="M9.7 11h4.6M8.5 15h7" />
    </IconBase>
  )
}
