/**
 * retread — a tyre casing with a fresh tread band laid over it and a renewal arrow. Registered as `retread`.
 */
import IconBase from './IconBase'

export default function RetreadIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      {/* new tread band ticks around casing */}
      <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3" />
      {/* renewal arrow sweeping over the crown */}
      <path d="M7.8 6.6a7 7 0 0 1 8.7.4" />
      <path d="M17 4.4V7.6h-3.2" />
    </IconBase>
  )
}
