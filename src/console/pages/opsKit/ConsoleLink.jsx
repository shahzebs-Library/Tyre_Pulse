/**
 * ConsoleLink - a drill-down link to another console page. Uses the router
 * when there is one (no full reload, console session untouched) and a plain
 * anchor otherwise, so a page stays renderable outside a router.
 */
import { Link, useInRouterContext } from 'react-router-dom'

const CLS = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

export default function ConsoleLink({ to, children, icon: Icon, className = '', plain = false }) {
  const inRouter = useInRouterContext()
  const cls = plain ? `text-orange-300 hover:text-orange-200 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded ${className}` : `${CLS} ${className}`
  const body = (<>{Icon && <Icon size={12} aria-hidden="true" />}{children}</>)
  return inRouter ? <Link to={to} className={cls}>{body}</Link> : <a href={to} className={cls}>{body}</a>
}
