/** Canonical route ownership registry. Aliases are redirects, never modules. */
export const ROUTE_ALIASES = Object.freeze([
  { alias: '/delete-account', canonical: '/data-deletion', owner: 'Trust & Privacy', status: 'deprecated' },
  { alias: '/privacy-policy', canonical: '/privacy', owner: 'Trust & Privacy', status: 'deprecated' },
  { alias: '/ai', canonical: '/ai-command-center', owner: 'AI Operations', status: 'deprecated' },
  { alias: '/ai-administration', canonical: '/console/ai-admin', owner: 'System Console', status: 'deprecated' },
  { alias: '/users', canonical: '/console/users', owner: 'System Console', status: 'deprecated' },
])

const ALIAS_TO_CANONICAL = new Map(ROUTE_ALIASES.map(({ alias, canonical }) => [alias, canonical]))

/** Resolve an exact legacy pathname while preserving its query and hash. */
export function canonicalRoute(target) {
  if (typeof target !== 'string') return target
  const boundary = target.search(/[?#]/)
  const pathname = boundary === -1 ? target : target.slice(0, boundary)
  const suffix = boundary === -1 ? '' : target.slice(boundary)
  return `${ALIAS_TO_CANONICAL.get(pathname) || pathname}${suffix}`
}

export function isLegacyRoute(pathname) {
  return ALIAS_TO_CANONICAL.has(pathname)
}
