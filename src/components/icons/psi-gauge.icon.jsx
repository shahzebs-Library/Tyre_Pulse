/**
 * psi-gauge — tyre pressure dial: a semicircular gauge with a pointer needle.
 * Registered as `psi-gauge`.
 */
import IconBase from './IconBase'

export default function PsiGaugeIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 17a8 8 0 0 1 16 0" />
      <path d="M4 17h2M18 17h2M12 9v1.5M6.6 11.6l1 1M17.4 11.6l-1 1" />
      <path d="M12 17 15 12.5" />
      <circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none" />
    </IconBase>
  )
}
