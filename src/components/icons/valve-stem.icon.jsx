/**
 * valve-stem — a tyre valve stem with cap seated on the rim edge. Registered as `valve-stem`.
 */
import IconBase from './IconBase'

export default function ValveStemIcon(props) {
  return (
    <IconBase {...props}>
      {/* rim edge */}
      <path d="M4 20h16" />
      {/* stem base */}
      <path d="M9.5 20v-2.5h5V20" />
      {/* stem body */}
      <path d="M10.5 17.5v-8h3v8" />
      {/* valve cap */}
      <path d="M9.5 9.5h5V6a2.5 2.5 0 0 0-5 0z" />
    </IconBase>
  )
}
