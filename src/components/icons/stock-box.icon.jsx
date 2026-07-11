/**
 * stock-box — an inventory carton (open-flap crate). Registered as `stock-box`.
 */
import IconBase from './IconBase'

export default function StockBoxIcon(props) {
  return (
    <IconBase {...props}>
      {/* lid flaps */}
      <path d="M3.5 8 12 5l8.5 3-8.5 3z" />
      {/* body */}
      <path d="M3.5 8v9l8.5 3 8.5-3V8" />
      {/* center seam */}
      <path d="M12 11v9" />
    </IconBase>
  )
}
