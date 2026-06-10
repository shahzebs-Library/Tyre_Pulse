import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, Wifi, X } from 'lucide-react'

/**
 * PwaUpdatePrompt
 *
 * Shows two non-intrusive toasts:
 *  1. "Offline ready" — first time the SW installs and caches the app.
 *  2. "Update available" — when a new SW version is waiting; lets the
 *     user choose to reload now or dismiss.
 *
 * Wire it once near the top of the React tree (App.jsx).
 * No props needed.
 */
export default function PwaUpdatePrompt() {
  const {
    offlineReady:      [offlineReady,  setOfflineReady],
    needRefresh:       [needRefresh,   setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      // Auto-check for updates every 60 minutes while the app is open
      if (r) {
        setInterval(() => {
          if (!(!r.installing && navigator)) return
          if ('connection' in navigator && !navigator.onLine) return
          const resp = fetch(swUrl, { cache: 'no-store', headers: { cache: 'no-store', 'cache-control': 'no-cache' } })
          resp.then(r => { if (r?.status === 200) r.update() }).catch(() => {})
        }, 60 * 60 * 1000)
      }
    },
    onRegisterError(err) {
      if (import.meta.env.DEV) console.warn('[PWA] SW registration failed:', err)
    },
  })

  const closeOffline = () => setOfflineReady(false)
  const closeUpdate  = () => setNeedRefresh(false)
  const doUpdate     = () => updateServiceWorker(true)

  if (!offlineReady && !needRefresh) return null

  return (
    <div
      role="region"
      aria-label="App update notifications"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0"
    >
      {/* ── Offline ready toast ──────────────────────────────────────────── */}
      {offlineReady && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-2xl animate-in slide-in-from-bottom-2"
        >
          <span className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-emerald-900/50 flex items-center justify-center">
            <Wifi className="w-4 h-4 text-emerald-400" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-100">Ready for offline use</p>
            <p className="text-xs text-slate-400 mt-0.5">TyrePulse has been cached and works without an internet connection.</p>
          </div>
          <button
            onClick={closeOffline}
            aria-label="Dismiss"
            className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Update available toast ───────────────────────────────────────── */}
      {needRefresh && (
        <div
          role="alertdialog"
          aria-live="assertive"
          aria-label="Update available"
          className="flex items-start gap-3 bg-slate-800 border border-blue-700/60 rounded-xl p-4 shadow-2xl animate-in slide-in-from-bottom-2"
        >
          <span className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-blue-900/50 flex items-center justify-center">
            <RefreshCw className="w-4 h-4 text-blue-400" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-100">Update available</p>
            <p className="text-xs text-slate-400 mt-0.5">A new version of TyrePulse is ready.</p>
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={doUpdate}
                className="text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Reload &amp; update
              </button>
              <button
                onClick={closeUpdate}
                className="text-xs font-medium text-slate-400 hover:text-slate-200 px-2 py-1.5 transition-colors"
              >
                Later
              </button>
            </div>
          </div>
          <button
            onClick={closeUpdate}
            aria-label="Dismiss"
            className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
