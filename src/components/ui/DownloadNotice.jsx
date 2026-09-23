import { useEffect } from 'react'
import { X } from 'lucide-react'
export default function DownloadNotice({ message, busy, onDismiss }) {
  useEffect(() => {
    if (!message || busy) return
    const timer = setTimeout(onDismiss, 8000)
    return () => clearTimeout(timer)
  }, [message, busy, onDismiss])
  if (!message) return null
  return <div role="status" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-[var(--input-border)] bg-[var(--surface-raised)] p-4 shadow-lg text-sm flex items-start gap-3">
    <span>{message}</span>
    {!busy && <button type="button" onClick={onDismiss} aria-label="Dismiss download message" className="shrink-0 p-1"><X size={16} /></button>}
  </div>
}
