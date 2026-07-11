/**
 * bus — a passenger bus with window band and two wheels. Registered as `bus`.
 */
import IconBase from './IconBase'

export default function BusIcon(props) {
  return (
    <IconBase {...props}>
      {/* body */}
      <path d="M4 5h16v11H4z" />
      {/* window band */}
      <path d="M4 9h16" />
      {/* window mullions */}
      <path d="M9 5v4M14 5v4" />
      {/* wheels */}
      <circle cx="8" cy="18" r="1.75" />
      <circle cx="16" cy="18" r="1.75" />
    </IconBase>
  )
}
