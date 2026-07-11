/**
 * recall-alert — a warning triangle with an exclamation. Registered as `recall-alert`.
 */
import IconBase from './IconBase'

export default function RecallAlertIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3.5 21 19H3z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17h.01" />
    </IconBase>
  )
}
