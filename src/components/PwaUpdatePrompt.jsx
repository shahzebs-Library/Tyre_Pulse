import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, Wifi, X } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'

const UPDATE_INTERVAL_MS = 15 * 60 * 1000 // 15 min - iOS throttles background timers

export default function PwaUpdatePrompt() {
  const { t } = useLanguage()
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

      // Visibility handler. On VISIBLE, check for a new deploy (iOS suspends
      // background timers, so a refocus is the reliable trigger).
      //
      // There used to be a HIDDEN branch that quietly applied a waiting update
      // so kiosks self-healed. It was the cause of the blank first screen and
      // is deliberately gone. Applying an update posts SKIP_WAITING; the new
      // worker activates, Workbox deletes the previous build's precached chunks,
      // and clientsClaim hands it the still-live old page - which is then told
      // to reload while the tab is hidden and therefore frozen. The user came
      // back to a half-torn-down document whose chunks no longer existed.
      //
      // Nothing is lost: a waiting worker activates on its own once every
      // controlled tab is gone, so the next real launch is already up to date,
      // and a visible tab still gets the explicit "New version available"
      // prompt below.
      const onVisibility = () => {
        if (document.visibilityState !== 'visible') return
        if (navigator.onLine) registration.update().catch(() => {})
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
