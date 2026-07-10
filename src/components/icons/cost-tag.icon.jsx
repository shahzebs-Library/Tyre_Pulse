/**
 * cost-tag — a price tag with a currency mark. Registered as `cost-tag`.
 */
import IconBase from './IconBase'

export default function CostTagIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M3.5 12.5 12 4h6.5A1.5 1.5 0 0 1 20 5.5V12l-8.5 8.5a1.7 1.7 0 0 1-2.4 0l-5.6-5.6a1.7 1.7 0 0 1 0-2.4z" />
      <circle cx="16" cy="8" r="1.1" />
      {/* currency stroke */}
      <path d="M9.5 11.5v5M11 12.6a1.4 1.4 0 0 0-1.5-.9c-.9 0-1.6.5-1.6 1.2s.7 1 1.6 1.2 1.6.5 1.6 1.2-.7 1.2-1.6 1.2a1.4 1.4 0 0 1-1.5-.9" />
    </IconBase>
  )
}
