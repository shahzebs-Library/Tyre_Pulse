/**
 * rim — a bare wheel rim: outer barrel, inner bead seat and bolt holes. Registered as `rim`.
 */
import IconBase from './IconBase'

export default function RimIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.5" />
      {/* centre bore */}
      <circle cx="12" cy="12" r="1.25" />
      {/* bolt holes */}
      <path d="M12 7.5v1M12 15.5v1M7.5 12h1M15.5 12h1" />
    </IconBase>
  )
}
