/**
 * truck — a rigid truck: cab, box body and two wheels. Registered as `truck`.
 */
import IconBase from './IconBase'

export default function TruckIcon(props) {
  return (
    <IconBase {...props}>
      {/* box body */}
      <path d="M2 6h11v9H2z" />
      {/* cab */}
      <path d="M13 9h4l3 3v3h-7z" />
      {/* wheels */}
      <circle cx="6" cy="18" r="1.75" />
      <circle cx="17" cy="18" r="1.75" />
      {/* axle line between wheels */}
      <path d="M7.75 18h1.5M2 18h1.5" />
    </IconBase>
  )
}
