/**
 * openConsoleRoute - navigate WITHIN the console for a /console/* route, but open
 * any MAIN-APP route in a new browser tab.
 *
 * Why: the console runs its own tab-local super-admin session (sessionStorage
 * 'tp_console_auth'), separate from the main app's session ('tp_auth'). A
 * same-tab navigation from a /console page into a main-app route (e.g.
 * /data-reconciliation) leaves the console shell, loses that session, and lands
 * the user on the frontend login. Opening the main-app route in a NEW tab keeps
 * the console intact and lets the user's normal (Admin) session apply there.
 *
 * @param {string} route     the target path
 * @param {Function} navigate react-router navigate (for in-console routes)
 */
export function openConsoleRoute(route, navigate) {
  const r = String(route || '')
  if (!r) return
  if (r.startsWith('/console')) {
    if (typeof navigate === 'function') navigate(r)
    return
  }
  // Main-app route: open in a new tab so the console session is preserved.
  try {
    window.open(r, '_blank', 'noopener,noreferrer')
  } catch {
    if (typeof navigate === 'function') navigate(r)
  }
}

/** True when a route stays inside the console shell. */
export function isConsoleRoute(route) {
  return String(route || '').startsWith('/console')
}
