/**
 * Read the opening tab of a page from the address bar (?tab=key).
 *
 * Several pages were folded into a tab of a deeper page; their old routes
 * redirect to the keeper with ?tab=<key> so a saved link or bookmark still
 * lands on the same content. Unknown or missing values fall back, so a typo
 * in the address can never open a blank page.
 */
export function initialTabFromUrl(allowed, fallback, search) {
  try {
    const source = search ?? (typeof window !== 'undefined' ? window.location.search : '')
    const wanted = new URLSearchParams(source || '').get('tab')
    return wanted && allowed.includes(wanted) ? wanted : fallback
  } catch {
    return fallback
  }
}
