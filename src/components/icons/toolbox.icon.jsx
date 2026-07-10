/**
 * toolbox — a carry tote with handle. Registered as `toolbox`.
 */
import IconBase from './IconBase'

export default function ToolboxIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="8" width="18" height="12" rx="1.5" />
      <path d="M3 13h18" />
      {/* handle */}
      <path d="M9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2" />
      {/* latch */}
      <path d="M10.5 13v2.5h3V13" />
    </IconBase>
  )
}
