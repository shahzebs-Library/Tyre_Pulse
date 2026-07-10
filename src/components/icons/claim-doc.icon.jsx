/**
 * claim-doc — a document with a currency mark (claim/settlement). Registered as `claim-doc`.
 */
import IconBase from './IconBase'

export default function ClaimDocIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      {/* currency mark */}
      <path d="M12 10.5v7" />
      <path d="M13.8 12.2a1.9 1.9 0 0 0-1.8-1.1c-1.1 0-2 .7-2 1.6s.9 1.4 2 1.6 2 .7 2 1.6-.9 1.6-2 1.6a1.9 1.9 0 0 1-1.8-1.1" />
    </IconBase>
  )
}
