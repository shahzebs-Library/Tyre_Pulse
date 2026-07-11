/**
 * toe-in — toe alignment: two wheels (top view) angled inward toward a centre
 * direction of travel. Registered as `toe-in`.
 */
import IconBase from './IconBase'

export default function ToeInIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 4v16" />
      <path d="M6.5 6 8 18" />
      <path d="M17.5 6 16 18" />
      <path d="m9 3 3 2 3-2" />
    </IconBase>
  )
}
