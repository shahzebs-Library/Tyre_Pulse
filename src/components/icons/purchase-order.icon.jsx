/**
 * purchase-order — a document with a cart mark (PO). Registered as `purchase-order`.
 */
import IconBase from './IconBase'

export default function PurchaseOrderIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      {/* mini cart */}
      <path d="M9 11h1l.9 4.2h4.1l.8-3.2H10.4" />
      <circle cx="11.2" cy="17" r="0.7" />
      <circle cx="14.6" cy="17" r="0.7" />
    </IconBase>
  )
}
