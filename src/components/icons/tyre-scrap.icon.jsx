/**
 * tyre-scrap — a scrapped tyre marked with a cross. Registered as `tyre-scrap`.
 */
import IconBase from './IconBase'

export default function TyreScrapIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      {/* scrap cross */}
      <path d="M8 8l8 8M16 8l-8 8" />
    </IconBase>
  )
}
