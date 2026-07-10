/**
 * forklift — a forklift with mast, forks and two wheels. Registered as `forklift`.
 */
import IconBase from './IconBase'

export default function ForkliftIcon(props) {
  return (
    <IconBase {...props}>
      {/* body / cab */}
      <path d="M3 8h7v7H3z" />
      {/* overhead guard post */}
      <path d="M4 8V4h5v4" />
      {/* mast */}
      <path d="M13 3v13" />
      {/* fork */}
      <path d="M13 15h5" />
      <path d="M17.5 15v-3" />
      {/* wheels */}
      <circle cx="6" cy="18" r="1.75" />
      <circle cx="12" cy="18" r="1.75" />
    </IconBase>
  )
}
