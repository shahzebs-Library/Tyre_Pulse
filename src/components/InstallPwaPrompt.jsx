import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'

export default function InstallPwaPrompt() {
  const [prompt, setPrompt] = useState(null)
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem('pwa_prompt_dismissed') === 'true'
  )

  useEffect(() => {
    const handler = e => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!prompt || dismissed) return null

  async function handleInstall() {
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setPrompt(null)
  }

  function handleDismiss() {
    setDismissed(true)
    localStorage.setItem('pwa_prompt_dismissed', 'true')
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-2xl flex items-start gap-3">
      <div className="flex-1">
        <p className="text-white font-semibold text-sm">Install TyrePulse</p>
        <p className="text-gray-400 text-xs mt-0.5">Add to home screen for quick access and offline support</p>
        <button
          onClick={handleInstall}
          className="mt-2 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> Install App
        </button>
      </div>
      <button onClick={handleDismiss} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
