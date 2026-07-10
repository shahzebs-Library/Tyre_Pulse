/**
 * checklist-clip — a clipboard with ticked lines. Registered as `checklist-clip`.
 */
import IconBase from './IconBase'

export default function ChecklistClipIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="5" y="4" width="14" height="17" rx="1.5" />
      {/* clip */}
      <path d="M9 4V3.2A1.2 1.2 0 0 1 10.2 2h3.6A1.2 1.2 0 0 1 15 3.2V4" />
      {/* ticks + lines */}
      <path d="m8 9.5 1 1 1.8-1.8" />
      <path d="M13 9.7h3" />
      <path d="m8 14 1 1 1.8-1.8" />
      <path d="M13 14.2h3" />
    </IconBase>
  )
}
