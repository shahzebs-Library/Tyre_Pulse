import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, Wifi, X } from 'lucide-react'

const UPDATE_INTERVAL_MS = 15 * 60 * 1000 // 15 min - iOS throttles background timers

export default function PwaUpdatePrompt() {
  const registrationRef = useRef(null)

  const {
    offlineReady:  [offlineReady,  setOfflineReady],
    needRefresh:   [needRefresh,   setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      registrationRef.current = registration

      // Periodic update poll - calls .update() on the ServiceWorkerRegistration
      // (previous bug: mistakenly called .update() on a fetch Response, never worked)
      const interval = setInterval(() => {
        if (!navigator.onLine) return
        registration.update().catch(() => {})
      }, UPDATE_INTERVAL_MS)

      // iOS critical: check for updates every time the app comes to foreground
      // (iOS suspends background timers, so visibility changes are the reliable trigger)
      const onVisible = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          registration.update().catch(() => {})
        }
      }
      document.addEventListener('visibilitychange', onVisible)

      // Store cleanup on the ref so it can be called on unmount
      registrationRef.current._cleanup = () => {
        clearInterval(interval)
        document.removeEventListener('visibilitychange', onVisible)
      }
    },
    onRegisterError(err) {
      if (import.meta.env.DEV) console.warn('[PWA] SW registration failed:', err)
    },
  })

  useEffect(() => {
    return () => {
      registrationRef.current?._cleanup?.()
    }
  }, [])

  const doUpdate = () => updateServiceWorker(true) // sends SKIP_WAITING → new SW activates → reloads

  if (!offlineReady && !needRefresh) return null

  return (
    <div
      role="region"
      aria-label="App notifications"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0"
    >
      {offlineReady && !needRefresh && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-2xl"
        >
          <span className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-emerald-900/50 flex items-center justify-center">
            <Wifi className="w-4 h-4 text-emerald-400" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-100">Ready for offline use</p>
            <p className="text-xs text-slate-400 mt-0.5">TyrePulse has been cached and works without internet.</p>
          </div>
          <button
            onClick={() => setOfflineReady(false)}
            aria-label="Dismiss"
            className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {needRefresh && (
        <div
          role="alertdialog"
          aria-live="assertive"
          aria-label="Update available"
          className="flex items-start gap-3 bg-slate-800 border border-blue-700/60 rounded-xl p-4 shadow-2xl"
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
                onClick={() => setNeedRefresh(false)}
                className="text-xs font-medium text-slate-400 hover:text-slate-200 px-2 py-1.5 transition-colors"
              >
                Later
              </button>
            </div>
          </div>
          <button
            onClick={() => setNeedRefresh(false)}
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
