import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, Wifi, X } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'

const UPDATE_INTERVAL_MS = 15 * 60 * 1000 // 15 min - iOS throttles background timers

export default function PwaUpdatePrompt() {
  const { t } = useLanguage()
  const registrationRef = useRef(null)

  // Latest updater + pending-update flag, read from the hidden-tab auto-apply
  // handler without re-subscribing it on every render.
  const updateFnRef = useRef(null)
  const needRefreshRef = useRef(false)

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

      // Visibility handler, two jobs:
      //  - VISIBLE: check for a new deploy (iOS suspends background timers, so a
      //    refocus is the reliable trigger).
      //  - HIDDEN: if an update is already waiting, apply it QUIETLY now. The
      //    reload happens while nobody is looking, so a kiosk / TV / backgrounded
      //    tab self-heals to the latest build without ever interrupting work.
      const onVisibility = () => {
        if (document.visibilityState === 'visible') {
          if (navigator.onLine) registration.update().catch(() => {})
        } else if (needRefreshRef.current && typeof updateFnRef.current === 'function') {
          updateFnRef.current(true) // activate the waiting SW -> reload while hidden
        }
      }
      document.addEventListener('visibilitychange', onVisibility)

      // Store cleanup on the ref so it can be called on unmount
      registrationRef.current._cleanup = () => {
        clearInterval(interval)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    },
    onRegisterError(err) {
      if (import.meta.env.DEV) console.warn('[PWA] SW registration failed:', err)
    },
  })

  // Keep the refs the visibility handler reads in sync with the live hook state.
  useEffect(() => { updateFnRef.current = updateServiceWorker }, [updateServiceWorker])
  useEffect(() => { needRefreshRef.current = needRefresh }, [needRefresh])

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
      aria-label={t('pwa.notifications')}
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
            <p className="text-sm font-semibold text-slate-100">{t('pwa.offlineReadyTitle')}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t('pwa.offlineReadyBody')}</p>
          </div>
          <button
            onClick={() => setOfflineReady(false)}
            aria-label={t('pwa.dismiss')}
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
          aria-label={t('pwa.updateTitle')}
          className="flex items-start gap-3 bg-slate-800 border border-blue-700/60 rounded-xl p-4 shadow-2xl"
        >
          <span className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-blue-900/50 flex items-center justify-center">
            <RefreshCw className="w-4 h-4 text-blue-400" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-100">{t('pwa.updateTitle')}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t('pwa.updateBody')}</p>
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={doUpdate}
                className="text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                {t('pwa.reloadUpdate')}
              </button>
              <button
                onClick={() => setNeedRefresh(false)}
                className="text-xs font-medium text-slate-400 hover:text-slate-200 px-2 py-1.5 transition-colors"
              >
                {t('pwa.later')}
              </button>
            </div>
          </div>
          <button
            onClick={() => setNeedRefresh(false)}
            aria-label={t('pwa.dismiss')}
            className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
