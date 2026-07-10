/**
 * van — a panel van with a sloped nose and two wheels. Registered as `van`.
 */
import IconBase from './IconBase'

export default function VanIcon(props) {
  return (
    <IconBase {...props}>
      {/* van body with sloped bonnet */}
      <path d="M3 6h9v9H3z" />
      <path d="M12 6h4l4 4.5V15h-8z" />
      {/* windscreen */}
      <path d="M13 7.5h2.5l2 2.5H13z" />
      {/* wheels */}
      <circle cx="7" cy="17.5" r="1.75" />
      <circle cx="16" cy="17.5" r="1.75" />
    </IconBase>
  )
}
