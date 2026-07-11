/**
 * invoice — a billing document with line items and a total. Registered as `invoice`.
 */
import IconBase from './IconBase'

export default function InvoiceIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      {/* line items */}
      <path d="M9 11h4M9 13.5h6" />
      {/* total row */}
      <path d="M9 16.5h6" />
      <path d="M9 18.5h3" />
    </IconBase>
  )
}
