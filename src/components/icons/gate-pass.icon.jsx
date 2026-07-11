/**
 * gate-pass — a boom barrier with a checkmark clearance. Registered as `gate-pass`.
 */
import IconBase from './IconBase'

export default function GatePassIcon(props) {
  return (
    <IconBase {...props}>
      {/* post */}
      <path d="M5 21V6" />
      <path d="M3.5 21h3" />
      {/* boom raised */}
      <path d="M5 8 20 5" />
      {/* stripes on boom */}
      <path d="M9.5 7.1 10.7 9M13.5 6.3 14.7 8.2M17.5 5.6l1.2 1.8" />
      {/* clearance check */}
      <path d="M14 15.5l1.6 1.6 3.4-3.6" />
    </IconBase>
  )
}
