/**
 * CopilotCard - embedded one-click AI insight ("✨ AI insight") for detail views.
 *
 * Renders a compact trigger button; on click runs an aiCopilot task against the
 * secure chat-ai edge function and expands into a card with the structured
 * response (Observation / Root cause / Risk / Actions), copy, regenerate and
 * collapse controls. Responses are cached per record version in aiCopilot.js.
 *
 * RBAC: AI features are Admin-only (Intelligence group) — callers should also
 * gate, but the card self-guards and renders nothing for non-admins.
 */
import { useState, useCallback } from 'react'
import { Sparkles, Copy, RefreshCw, ChevronUp, AlertTriangle, Check } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { runCopilotTask, COPILOT_TASKS } from '../../lib/aiCopilot'

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Escape-first inline markdown (same XSS-safe pattern as AiCommandCenter).
function renderInline(text) {
  const safe = escapeHtml(text)
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-[var(--text-primary)] font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
}

function AiText({ text }) {
  const lines = String(text || '').split('\n')
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.trim() === '') return <div key={i} className="h-1" />
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={i} className="flex gap-2 ml-1">
              <span className="flex-shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              <span
                className="text-[var(--text-secondary)] text-sm leading-relaxed flex-1"
                dangerouslySetInnerHTML={{ __html: renderInline(line.replace(/^[-*]\s/, '')) }}
              />
            </div>
          )
        }
        return (
          <p
            key={i}
            className="text-[var(--text-secondary)] text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderInline(line) }}
          />
        )
      })}
    </div>
  )
}

export default function CopilotCard({ task, context, className = '' }) {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)

  const def = COPILOT_TASKS[task]

  const run = useCallback(async (bypassCache = false) => {
    setLoading(true)
    setError('')
    try {
      const res = await runCopilotTask(task, context, { bypassCache })
      setText(res.text)
    } catch (e) {
      setError(e?.message || 'AI request failed.')
    } finally {
      setLoading(false)
    }
  }, [task, context])

  // AI (Intelligence) is Admin-only — mirror the app's gating.
  if (profile?.role !== 'Admin' || !def) return null

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); if (!text) run() }}
        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[var(--border-dim)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors ${className}`}
        title={def.label}
      >
        <Sparkles size={13} className="text-[var(--accent)]" />
        {def.label}
      </button>
    )
  }

  return (
    <div className={`card border border-[var(--border-dim)] ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
          <Sparkles size={14} className="text-[var(--accent)]" />
          {def.label}
        </span>
        <div className="flex items-center gap-1.5">
          {text && !loading && (
            <>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(text).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }).catch(() => {})
                }}
                className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Copy"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button
                onClick={() => run(true)}
                className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Regenerate"
              >
                <RefreshCw size={13} />
              </button>
            </>
          )}
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Collapse"
          >
            <ChevronUp size={13} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="space-y-2 py-1 animate-pulse" aria-label="Generating AI insight">
          <div className="h-2.5 rounded bg-[var(--input-bg)] w-3/4" />
          <div className="h-2.5 rounded bg-[var(--input-bg)] w-full" />
          <div className="h-2.5 rounded bg-[var(--input-bg)] w-1/2" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-2 text-sm text-red-400">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div>
            <p>{error}</p>
            <button onClick={() => run()} className="mt-1 text-xs underline text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !error && text && (
        <>
          <AiText text={text} />
          <p className="mt-2 text-[10px] text-[var(--text-muted)]">
            AI-generated from record data; verify before acting. Repeated views use a cached response.
          </p>
        </>
      )}
    </div>
  )
}
