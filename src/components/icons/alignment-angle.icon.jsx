/**
 * alignment-angle — wheel alignment angle: baseline with an angled arm and arc.
 * Registered as `alignment-angle`.
 */
import IconBase from './IconBase'

export default function AlignmentAngleIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 19h16" />
      <path d="M5 19 18 6" />
      <path d="M5 19h9" />
      <path d="M14 19a10 10 0 0 0-3-6.4" />
    </IconBase>
  )
}
