// Recovery from a stale service-worker precache.
//
// Symptom this exists for: the app opens to a blank screen, and a manual
// refresh fixes it. That happens when a worker from a previous deploy is still
// answering navigations with an old index.html while the chunks that HTML
// references have already been deleted from the cache (and are no longer on the
// CDN). Every dynamic import() then rejects, React never mounts its tree, and
// the page paints nothing.
//
// The service-worker config changes stop NEW clients from getting into that
// state. This is what rescues the ones already in it, since a browser stuck on
// a bad worker will otherwise keep loading the same broken document forever.
//
// It is deliberately a ONE-SHOT per tab. A reload loop is far worse than a
// blank screen, so the guard is written before the reload is requested and is
// only released once the app has actually rendered.

const RELOAD_GUARD_KEY = 'tp_chunk_reload'

// Vite, webpack and Safari each word this differently; all three mean the same
// thing - a module the app asked for could not be fetched or parsed.
const CHUNK_ERROR_RE =
  /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed|error loading dynamically imported module/i

export function isChunkLoadError(reason) {
  if (!reason) return false
  const name = typeof reason === 'object' && reason !== null ? String(reason.name ?? '') : ''
  if (name === 'ChunkLoadError') return true
  const message =
    typeof reason === 'string'
      ? reason
      : String((reason && (reason.message ?? reason.reason)) ?? '')
  return CHUNK_ERROR_RE.test(message)
}

function canUseSessionStorage() {
  try {
    // Safari in private mode throws on write, so probe rather than assume.
    window.sessionStorage.setItem('tp_probe', '1')
    window.sessionStorage.removeItem('tp_probe')
    return true
  } catch {
    return false
  }
}

/**
 * Drop every Cache Storage entry and unregister every service worker, then
 * reload once. Both are best-effort: a browser that denies cache access still
 * gets the reload, which is the part that actually recovers the page.
 */
async function purgeAndReload() {
  try {
    if (typeof caches !== 'undefined' && caches?.keys) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)))
    }
  } catch { /* fall through to the reload */ }

  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)))
  } catch { /* fall through to the reload */ }

  window.location.reload()
}

/**
 * Install the one-shot chunk-load recovery listener.
 * Safe to call more than once; only the first call registers.
 */
export function installChunkRecovery() {
  if (typeof window === 'undefined') return
  if (window.__tpChunkRecoveryInstalled) return
  window.__tpChunkRecoveryInstalled = true

  const storageOk = canUseSessionStorage()

  const attemptRecovery = (reason) => {
    if (!isChunkLoadError(reason)) return
    // Already tried once this tab: do not loop. The error boundary's own
    // "Reload App" button remains available to the user.
    if (storageOk && window.sessionStorage.getItem(RELOAD_GUARD_KEY)) return
    if (storageOk) window.sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
    purgeAndReload()
  }

  window.addEventListener('unhandledrejection', (e) => attemptRecovery(e?.reason))
  // A failing <script type="module"> surfaces here rather than as a rejection.
  window.addEventListener('error', (e) => attemptRecovery(e?.error ?? e?.message))
}

/**
 * Called once the app has genuinely rendered. Clearing the guard means a chunk
 * failure LATER in the session (the more common case - a deploy lands while the
 * tab is open) can still recover once, without ever allowing a boot loop.
 */
export function markAppRendered() {
  try { window.sessionStorage.removeItem(RELOAD_GUARD_KEY) } catch { /* nothing to clear */ }
}
