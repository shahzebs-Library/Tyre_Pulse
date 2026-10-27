import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { readJobStatuses, subscribeAiTyreJobs } from '../../lib/api/aiTyreProgress'
import { shapeAiTyreProgress } from '../../lib/aiTyreProgress'

const POLL_MS = 5000
const DEBOUNCE_MS = 1000

/** Live "AI analysing 5 of 13" chip. Renders nothing when the inspection has no AI jobs. */
export default function AiTyreProgress({ inspectionId }) {
  const [progress, setProgress] = useState(() => shapeAiTyreProgress([]))
  const alive = useRef(true)
  const timer = useRef(null)

  const load = useCallback(async () => {
    try {
      const rows = await readJobStatuses(inspectionId)
      if (alive.current) setProgress(shapeAiTyreProgress(rows))
    } catch { /* keep last known progress */ }
  }, [inspectionId])

  useEffect(() => {
    alive.current = true
    setProgress(shapeAiTyreProgress([]))
    load()
    const unsub = inspectionId
      ? subscribeAiTyreJobs(inspectionId, () => {
          clearTimeout(timer.current)
          timer.current = setTimeout(load, DEBOUNCE_MS)
        })
      : null
    return () => { alive.current = false; clearTimeout(timer.current); if (unsub) unsub() }
  }, [inspectionId, load])

  // Poll fallback only while something is still pending.
  useEffect(() => {
    if (!progress.active) return undefined
    const id = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    return () => clearInterval(id)
  }, [progress.active, load])

  if (!progress.total) return null
  return (
    <span role="status" aria-live="polite" className="iw-ai-progress"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border, #ccc)' }}>
      <Sparkles size={13} aria-hidden="true" /> {progress.label}
    </span>
  )
}
