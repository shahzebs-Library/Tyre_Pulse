/**
 * regroove — tyre regrooving: a cutting tool carving a fresh groove into worn
 * tread. Registered as `regroove`.
 */
import IconBase from './IconBase'

export default function RegrooveIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 16h16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M8 16v2.5M12 16v2.5M16 16v2.5" />
      <path d="M15 4 9.5 9.5l1.5 1.5L16.5 5.5z" />
      <path d="m15 4 2-1 1 1-1 2z" />
    </IconBase>
  )
}
