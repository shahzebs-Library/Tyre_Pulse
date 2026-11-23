import { navEmojiFor, NAV_EMOJI_SPRITE } from '../../lib/navEmoji'

/**
 * Page icon: the route's Fluent emoji on a soft tile, or the given line icon when
 * the route has no emoji. Decorative only (aria-hidden); the label names the page.
 */
export default function NavEmoji({ path, fallback: Fallback, size = 16, tile = 24, className = '', fallbackProps = {} }) {
  const name = navEmojiFor(path)
  if (!name) return Fallback ? <Fallback size={size} aria-hidden="true" className={className} {...fallbackProps} /> : null
  return (
    <span
      className={`nav-emoji inline-grid place-items-center flex-shrink-0 rounded-md ${className}`}
      style={{ width: tile, height: tile }}
      aria-hidden="true"
    >
      <svg width={size} height={size} focusable="false">
        <use href={`${NAV_EMOJI_SPRITE}#ne-${name}`} />
      </svg>
    </span>
  )
}
