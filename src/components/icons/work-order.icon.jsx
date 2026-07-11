/**
 * work-order — a job sheet with a wrench mark. Registered as `work-order`.
 */
import IconBase from './IconBase'

export default function WorkOrderIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      {/* wrench mark */}
      <path d="M13.4 11.2a1.9 1.9 0 0 0 2.4 2.4l.9.9a1.1 1.1 0 0 1-1.6 1.6l-.9-.9a1.9 1.9 0 0 1-2.4-2.4z" />
      <path d="M9 12.5h1.6M9 16h4" />
    </IconBase>
  )
}
