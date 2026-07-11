/**
 * spare-tyre — a tyre with a plus mark denoting a spare. Registered as `spare-tyre`.
 */
import IconBase from './IconBase'

export default function SpareTyreIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="13" r="8" />
      <circle cx="11" cy="13" r="3" />
      {/* spare plus badge */}
      <path d="M19 3v5M16.5 5.5h5" />
    </IconBase>
  )
}
