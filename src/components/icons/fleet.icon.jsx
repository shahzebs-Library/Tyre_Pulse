/**
 * fleet — a group of trucks moving together. Registered as `fleet`.
 */
import IconBase from './IconBase'

export default function FleetIcon(props) {
  return (
    <IconBase {...props}>
      {/* lead truck cab + box */}
      <path d="M3 8h8v6H3z" />
      <path d="M11 10h3l2.2 2.2V14H11z" />
      <circle cx="6" cy="16.5" r="1.4" />
      <circle cx="13.5" cy="16.5" r="1.4" />
      {/* trailing vehicle hint */}
      <path d="M17 6h4M19 4v4" />
      <path d="M18 19.5h4" />
    </IconBase>
  )
}
