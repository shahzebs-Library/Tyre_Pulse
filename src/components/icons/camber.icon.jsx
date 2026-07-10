/**
 * camber — wheel camber: a tilted tyre viewed head-on against a vertical
 * reference line, showing the lean angle. Registered as `camber`.
 */
import IconBase from './IconBase'

export default function CamberIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3v18" />
      <path d="M4 20h16" />
      <path d="M9 5 15 19" />
      <path d="M14.2 4.2 8 6.4l1.6 5.9 6.2-2.2z" />
    </IconBase>
  )
}
