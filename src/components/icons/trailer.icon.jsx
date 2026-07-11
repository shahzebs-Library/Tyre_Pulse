/**
 * trailer — a towed trailer box with a hitch coupling. Registered as `trailer`.
 */
import IconBase from './IconBase'

export default function TrailerIcon(props) {
  return (
    <IconBase {...props}>
      {/* trailer box */}
      <path d="M5 6h15v10H5z" />
      {/* draw bar and hitch */}
      <path d="M5 12H2.5" />
      <circle cx="2" cy="12" r="0.6" fill="currentColor" />
      {/* wheels */}
      <circle cx="10" cy="18.5" r="1.75" />
      <circle cx="15" cy="18.5" r="1.75" />
    </IconBase>
  )
}
