/**
 * One icon per page, shared by the sidebar and the Ctrl+K palette so the two can
 * never disagree. Route -> Fluent Emoji Flat name (MIT); the art lives in one
 * cached sprite, public/nav-emoji.svg, built by scripts/build-nav-emoji.cjs.
 */
import MAP from './navEmojiMap.json'

export const NAV_EMOJI_SPRITE = '/nav-emoji.svg'

/** Emoji name for a route (exact, then without the query string), or null. */
export function navEmojiFor(path) {
  if (!path) return null
  const p = String(path)
  if (MAP[p]) return MAP[p]
  const bare = p.split('#')[0]
  if (MAP[bare]) return MAP[bare]
  const [noQuery, query = ''] = bare.split('?')
  // A page link carries one key param (/stock?section=x); extra params such as
  // &tab=y still resolve to that page's icon.
  for (const pair of query.split('&')) {
    if (pair && MAP[`${noQuery}?${pair}`]) return MAP[`${noQuery}?${pair}`]
  }
  return MAP[noQuery] || null
}

export const NAV_EMOJI_ROUTES = Object.keys(MAP)
