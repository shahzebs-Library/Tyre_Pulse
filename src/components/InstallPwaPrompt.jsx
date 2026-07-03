import { useState, useEffect } from 'react'
import { Download, Share, Plus, X } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'

function isIos() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isInStandaloneMode() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function wasDismissedRecently() {
  try {
    const ts = localStorage.getItem('pwa_prompt_dismissed_at')
    if (!ts) return false
    return Date.now() - Number(ts) < 14 * 24 * 60 * 60 * 1000 // 14-day cooldown
  } catch { return false }
}

function markDismissed() {
  try { localStorage.setItem('pwa_prompt_dismissed_at', String(Date.now())) } catch {}
}

export default function InstallPwaPrompt() {
  const { t } = useLanguage()
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showIosHint,    setShowIosHint]    = useState(false)
  const [visible,        setVisible]        = useState(false)

  useEffect(() => {
    if (isInStandaloneMode() || wasDismissedRecently()) return

    if (isIos()) {
      const t = setTimeout(() => setShowIosHint(true), 4000)
      return () => clearTimeout(t)
    }

    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => { if (deferredPrompt) setVisible(true) }, [deferredPrompt])

  function handleDismiss() {
    markDismissed()
    setVisible(false)
    setShowIosHint(false)
    setDeferredPrompt(null)
  }

  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') { setVisible(false); setDeferredPrompt(null) }
  }

  // ── iOS Safari install guide ─────────────────────────────────────────────
  if (showIosHint) {
    return (
      <div
        role="dialog"
        aria-label={t('pwa.iosAria')}
        className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-md border-t border-slate-700 p-5"
        style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-md mx-auto">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <img src="/icons/icon-72x72.png" alt="" className="w-10 h-10 rounded-xl" />
              <div>
                <p className="text-sm font-bold text-slate-100">{t('pwa.installTitle')}</p>
                <p className="text-xs text-slate-400">{t('pwa.installSubtitle')}</p>
              </div>
            </div>
            <button onClick={handleDismiss} aria-label={t('pwa.installClose')} className="text-slate-500 hover:text-slate-300 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <ol className="space-y-2 text-xs text-slate-300">
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">1</span>
              <span className="flex items-center gap-1">{t('pwa.iosStep1')} <Share className="w-3.5 h-3.5 inline text-blue-400" /></span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">2</span>
              <span className="flex items-center gap-1">{t('pwa.iosStep2')} <Plus className="w-3.5 h-3.5 inline text-blue-400" /></span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">3</span>
              <span>{t('pwa.iosStep3')}</span>
            </li>
          </ol>
        </div>
      </div>
    )
  }

  // ── Android / Chrome install banner ─────────────────────────────────────
  if (!visible || !deferredPrompt) return null

  return (
    <div
      role="dialog"
      aria-label={t('pwa.installAria')}
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 bg-slate-800 border border-slate-700 rounded-2xl p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <img src="/icons/icon-72x72.png" alt="" className="w-10 h-10 rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-100">{t('pwa.installTitle')}</p>
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
            {t('pwa.installBody')}
          </p>
          <div className="flex gap-2 mt-2.5">
            <button
              onClick={handleInstall}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> {t('pwa.install')}
            </button>
            <button onClick={handleDismiss} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5 transition-colors">
              {t('pwa.notNow')}
            </button>
          </div>
        </div>
        <button onClick={handleDismiss} aria-label={t('pwa.dismiss')} className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
