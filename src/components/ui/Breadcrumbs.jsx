import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

/**
 * Breadcrumbs - derives a "Home / Group / Page" trail from the current route by
 * matching it against the app's NAV_GROUPS tree (so crumb labels always match
 * the sidebar). Unknown / dynamic segments (ids) fall back to a humanized label.
 *
 * The nav tree and the i18n t() helper are passed in from the shell so this
 * component stays free of circular imports and reuses the single source of nav
 * labels. Labels resolve via t(`nav.items.<route>`) with the raw NAV_GROUPS
 * label as fallback (mirrors Layout.jsx), and groups via t(`nav.groups.<label>`).
 *
 * Accessibility: renders as nav[aria-label="Breadcrumb"] with an ordered list;
 * the current page (last crumb) is non-clickable and marked aria-current="page".
 * Responsive: intermediate crumbs collapse on small screens, leaving only the
 * final (current-page) crumb visible next to the shell's global Back button.
 *
 * @param {Array}    navGroups  - the NAV_GROUPS tree ({ label, items:[{ to, label }] })
 * @param {Function} t          - i18n translator (optional; falls back to raw labels)
 * @param {string}   className
 */

// Humanize a raw path segment when it is not present in the nav tree.
function humanize(segment) {
  if (!segment) return ''
  let decoded = segment
  try { decoded = decodeURIComponent(segment) } catch { /* keep raw */ }
  // Numeric or uuid-like id segments (detail routes) get a stable label.
  if (/^\d+$/.test(decoded) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(decoded)) return 'Detail'
  return decoded
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

// Flatten NAV_GROUPS into a { '/route' -> { label, group } } lookup, once.
function indexNav(navGroups) {
  const map = new Map()
  for (const group of navGroups || []) {
    for (const item of group?.items || []) {
      if (item?.to) map.set(item.to, { label: item.label, group: group.label })
    }
  }
  return map
}

export default function Breadcrumbs({ navGroups = [], t, className = '' }) {
  const location = useLocation()
  const navIndex = useMemo(() => indexNav(navGroups), [navGroups])

  const trail = useMemo(() => {
    const path = location.pathname || '/'

    const itemLabel = (route, fallback) => {
      if (typeof t !== 'function') return fallback
      const key = `nav.items.${route}`
      const r = t(key)
      return !r || r === key ? fallback : r
    }
    const groupLabel = (g) => {
      if (typeof t !== 'function') return g
      const key = `nav.groups.${g}`
      const r = t(key)
      return !r || r === key ? g : r
    }
    const homeLabel = (() => {
      if (typeof t !== 'function') return 'Home'
      const r = t('nav.home')
      return !r || r === 'nav.home' ? 'Home' : r
    })()

    const crumbs = [{ to: '/', label: homeLabel }]
    if (path === '/' || path === '') return crumbs

    // Exact single-route match (the common case) keeps its group heading.
    const exact = navIndex.get(path)
    if (exact) {
      if (exact.group) crumbs.push({ label: groupLabel(exact.group), group: true })
      crumbs.push({ to: path, label: itemLabel(path, exact.label) })
      return crumbs
    }

    // Otherwise walk the path; a matched base route contributes its group, and
    // deeper (dynamic) segments are humanized so detail routes still read well.
    const segments = path.split('/').filter(Boolean)
    let accum = ''
    segments.forEach((seg, i) => {
      accum += `/${seg}`
      const known = navIndex.get(accum)
      if (i === 0 && known?.group) crumbs.push({ label: groupLabel(known.group), group: true })
      crumbs.push({ to: accum, label: known ? itemLabel(accum, known.label) : humanize(seg) })
    })
    return crumbs
  }, [location.pathname, navIndex, t])

  // Home (or an unresolvable single crumb) has nothing meaningful to show.
  if (trail.length <= 1) return null

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex items-center gap-1 min-w-0">
        {trail.map((crumb, i) => {
          const isLast = i === trail.length - 1
          const isGroup = crumb.group === true
          // On small screens collapse everything except the current page.
          const responsive = isLast ? 'inline-flex' : 'hidden md:inline-flex'
          return (
            <li key={`${crumb.label}-${i}`} className={`items-center gap-1 min-w-0 ${responsive}`}>
              {i > 0 && (
                <ChevronRight
                  size={12}
                  aria-hidden="true"
                  className="flex-shrink-0"
                  style={{ color: 'var(--text-muted)', opacity: 0.7 }}
                />
              )}
              {isLast || isGroup || !crumb.to ? (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className="truncate text-[12px] font-medium max-w-[42vw] md:max-w-[220px]"
                  style={{ color: isLast ? 'var(--text-primary)' : 'var(--text-muted)' }}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.to}
                  className="truncate text-[12px] font-medium transition-colors hover:underline max-w-[180px]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
