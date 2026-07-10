/**
 * trailer-axle — a trailer bogie: a beam under a bed carrying dual wheels. Registered as `trailer-axle`.
 */
import IconBase from './IconBase'

export default function TrailerAxleIcon(props) {
  return (
    <IconBase {...props}>
      {/* trailer bed */}
      <path d="M3 7h18" />
      {/* axle shaft */}
      <path d="M6 14h12" />
      {/* drop from bed to axle */}
      <path d="M12 7v7" />
      {/* left dual wheels */}
      <path d="M4 11v6M6.5 11.5v5" />
      {/* right dual wheels */}
      <path d="M20 11v6M17.5 11.5v5" />
    </IconBase>
  )
}
