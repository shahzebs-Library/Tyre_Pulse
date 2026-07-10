/**
 * tread-groove — tread pattern grooves: longitudinal tread channels running the
 * length of the tyre surface. Registered as `tread-groove`.
 */
import IconBase from './IconBase'

export default function TreadGrooveIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 4v16M12 4v16M16 4v16" />
    </IconBase>
  )
}
