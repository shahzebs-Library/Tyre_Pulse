import * as Router from 'react-router-dom'
import { navEmojiFor, NAV_EMOJI_SPRITE } from '../../lib/navEmoji'

// Read the router hooks once, defensively: a test that replaces the router
// module with a partial mock must still render a header (the icon falls back).
function routerHook(name) {
  try { return typeof Router[name] === 'function' ? Router[name] : null } catch { return null }
}
const realInRouter = routerHook('useInRouterContext')
const useLocationSafe = routerHook('useLocation')
// Same function on every render (chosen once at load), so hook order holds.
const useInRouterContextSafe = realInRouter && useLocationSafe ? realInRouter : () => false

/** One Fluent emoji from the shared sprite, by name. Decorative only. */
export function EmojiGlyph({ name, size = 16 }) {
  return (
    <svg width={size} height={size} focusable="false" aria-hidden="true">
      <use href={`${NAV_EMOJI_SPRITE}#ne-${name}`} />
    </svg>
  )
}

/**
 * Page icon: the route's Fluent emoji on a soft tile, or the given line icon when
 * the route has no emoji. Decorative only (aria-hidden); the label names the page.
 * `name` picks an emoji directly instead of looking it up by route.
 */
export default function NavEmoji({ path, name: forced, fallback: Fallback, size = 16, tile = 24, className = '', fallbackProps = {} }) {
  const name = forced || navEmojiFor(path)
  if (!name) return Fallback ? <Fallback size={size} aria-hidden="true" className={className} {...fallbackProps} /> : null
  return (
    <span
      className={`nav-emoji inline-grid place-items-center flex-shrink-0 rounded-md ${className}`}
      style={{ width: tile, height: tile }}
      aria-hidden="true"
    >
      <EmojiGlyph name={name} size={size} />
    </span>
  )
}

function LocatedEmoji({ path, fallback }) {
  const loc = useLocationSafe()
  const name = navEmojiFor(path || `${loc.pathname}${loc.search}`)
  return name ? <EmojiGlyph name={name} size={26} /> : fallback
}

/**
 * The current page's emoji, sized for a header tile (no tile of its own: the
 * caller's tile frames it). `path` overrides the router location. Outside a
 * router, or when the page has no emoji, the fallback node renders instead.
 */
export function RouteEmoji({ path, fallback = null }) {
  const inRouter = useInRouterContextSafe()
  if (!inRouter) {
    const name = path ? navEmojiFor(path) : null
    return name ? <EmojiGlyph name={name} size={26} /> : fallback
  }
  return <LocatedEmoji path={path} fallback={fallback} />
}
