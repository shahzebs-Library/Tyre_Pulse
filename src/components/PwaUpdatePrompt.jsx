import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, Wifi, X } from 'lucide-react'

const UPDATE_INTERVAL_MS = 15 * 60 * 1000 // 15 min — iOS limits background timers

export default function PwaUpdatePrompt() {
  const registrationRef = useRef(null)
  const [updating, setUpdating] = useState(false)

  const {
    offlineReady:  [offlineReady,  setOfflineReady],
    needRefresh:   [needRefresh,   setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      registrationRef.current = registration

      // Periodic update check — fixed: call r.update() on the Registration
      const interval = setInterval(() => {
        if (!navigator.onLine) return
        registration.update().catch(() => {})
      }, UPDATE_INTERVAL_MS)

      // Visibility check — critical for iOS: app returns to foreground from background
      const onVisible = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          registration.update().catch(() => {})
        }
      }
      document.addEventListener('visibilitychange', onVisible)

      // Cleanup on hot-reload in dev
      return () => {
        clearInterval(interval)
        document.removeEventListener('visibilitychange', onVisible)
      }
    },
    onRegisterError(err) {
      if (import.meta.env.DEV) console.warn('[PWA] SW registration failed:', err)
    },
  })

  // autoUpdate: new SW activates immediately — show brief toast then reload
  useEffect(() => {
    if (!needRefresh) return
    setUpdating(true)
    const t = setTimeout(() => updateServiceWorker(true), 1500)
    return () => clearTimeout(t)
  }, [needRefresh, updateServiceWorker])

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

      {updating && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 bg-slate-800 border border-blue-700/60 rounded-xl p-4 shadow-2xl"
        >
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-900/50 flex items-center justify-center">
            <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-100">Updating TyrePulse…</p>
            <p className="text-xs text-slate-400">Reloading to apply the latest version.</p>
          </div>
        </div>
      )}
    </div>
  )
}
