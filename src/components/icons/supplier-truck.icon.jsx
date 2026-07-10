/**
 * supplier-truck — a delivery truck with a box (procurement). Registered as `supplier-truck`.
 */
import IconBase from './IconBase'

export default function SupplierTruckIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M2.5 6h11v10h-11z" />
      <path d="M13.5 9h4l3 3v4h-7z" />
      <circle cx="6.5" cy="18" r="1.6" />
      <circle cx="16.5" cy="18" r="1.6" />
      <path d="M8.1 18h6.8" />
      {/* box on load */}
      <path d="M5 8.5h5v4H5z" />
    </IconBase>
  )
}
