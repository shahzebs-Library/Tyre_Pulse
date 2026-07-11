/**
 * workshop — a service bay building with a roller door. Registered as `workshop`.
 */
import IconBase from './IconBase'

export default function WorkshopIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M3 21V9l9-5 9 5v12" />
      <path d="M3 21h18" />
      {/* roller door */}
      <path d="M8 21v-6h8v6" />
      <path d="M8 17.5h8" />
    </IconBase>
  )
}
