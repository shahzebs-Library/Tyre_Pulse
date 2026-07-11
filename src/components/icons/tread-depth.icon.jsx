/**
 * tread-depth — a tread-depth gauge probing between tread ribs. Registered as `tread-depth`.
 */
import IconBase from './IconBase'

export default function TreadDepthIcon(props) {
  return (
    <IconBase {...props}>
      {/* tread ribs */}
      <path d="M4 16V8M9 16V8M15 16V8M20 16V8" />
      {/* tread floor */}
      <path d="M3 16h18" />
      {/* gauge probe dropping into a groove */}
      <path d="M12 3v10" />
      <path d="M9.5 6.5 12 4l2.5 2.5" />
    </IconBase>
  )
}
