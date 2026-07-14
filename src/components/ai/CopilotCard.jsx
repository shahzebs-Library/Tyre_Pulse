/**
 * CopilotCard - embedded one-click AI insight ("AI insight") for detail views.
 *
 * Renders a compact trigger button; on click runs an aiCopilot task against the
 * secure chat-ai edge function and expands into a card. The AI answer is parsed
 * into concise sections (Observation / Root cause / Risk / Actions) and rendered
 * on a WHITE panel with dark text so it is always readable regardless of theme.
 *
 * States: loading spinner, error with retry, honest placeholder, and structured
 * result. The renderer is defensive: any shape of text renders without crashing.
 *
 * RBAC: AI features are Admin-only (Intelligence group) - callers should also
 * gate, but the card self-guards and renders nothing for non-admins.
 */
import { useState, useCallback } from 'react'
import { Sparkles, Copy, RefreshCw, ChevronUp, AlertTriangle, Check, Loader2 } from 'lucide-react'
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

// Escape-first inline markdown, styled for a WHITE surface (dark text).
function renderInline(text) {
  const safe = escapeHtml(text)
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-900 font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-slate-700">$1</em>')
}

// Visual accent per known section header (case-insensitive match).
const SECTION_ACCENTS = [
  { test: /observation|summary/i, label: 'text-slate-500', dot: 'bg-slate-400' },
  { test: /root\s*cause/i,        label: 'text-amber-600', dot: 'bg-amber-500' },
  { test: /risk/i,                label: 'text-red-600',   dot: 'bg-red-500'   },
  { test: /action|recommend/i,    label: 'text-green-600', dot: 'bg-green-500' },
]

function accentFor(title) {
  return SECTION_ACCENTS.find(a => a.test.test(title)) || { label: 'text-slate-500', dot: 'bg-slate-400' }
}

/**
 * Parse the AI markdown into a lead line + labelled sections. Header lines are
 * bold tokens like "**Root cause**" (optionally with a trailing colon and inline
 * content). Anything before the first header becomes the summary lead. Line-based
 * so inline bold inside a body never mis-splits a section.
 */
function parseSections(raw) {
  const text = String(raw || '').trim()
  if (!text) return { summary: '', sections: [] }
  const headerRe = /^\s*\*\*(.+?)\*\*\s*:?\s*(.*)$/
  const lines = text.split('\n')
  let summary = []
  const sections = []
  let current = null
  for (const line of lines) {
    const m = line.match(headerRe)
    if (m) {
      current = { title: m[1].trim(), lines: [] }
      if (m[2] && m[2].trim()) current.lines.push(m[2].trim())
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      summary.push(line)
    }
  }
  return {
    summary: summary.join('\n').trim(),
    sections: sections.map(s => ({ title: s.title, body: s.lines.join('\n').trim() })),
  }
}

// Render a block of body text: bullets become a list, other lines are paragraphs.
function BodyText({ text }) {
  const lines = String(text || '').split('\n').filter(l => l.trim() !== '')
  if (lines.length === 0) return null
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const isBullet = /^[-*]\s/.test(line.trim())
        if (isBullet) {
          return (
            <div key={i} className="flex gap-2">
              <span className="flex-shrink-0 mt-[7px] w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span
                className="text-slate-700 text-sm leading-relaxed flex-1"
                dangerouslySetInnerHTML={{ __html: renderInline(line.replace(/^\s*[-*]\s/, '')) }}
              />
            </div>
          )
        }
        return (
          <p
            key={i}
            className="text-slate-700 text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderInline(line) }}
          />
        )
      })}
    </div>
  )
}

// Structured, concise render on a white panel. Falls back to plain body when the
// AI returns no recognizable sections, so it never shows a blank/black void.
function AiResult({ text }) {
  const { summary, sections } = parseSections(text)

  if (sections.length === 0) {
    return (
      <div className="rounded-lg bg-white border border-slate-200 p-3">
        <BodyText text={summary || text} />
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-white border border-slate-200 p-3 space-y-3">
      {summary && (
        <p
          className="text-slate-800 text-sm font-medium leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderInline(summary) }}
        />
      )}
      {sections.map((s, i) => {
        const accent = accentFor(s.title)
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${accent.dot}`} />
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${accent.label}`}>
                {s.title}
              </span>
            </div>
            <div className="pl-3">
              {s.body ? <BodyText text={s.body} /> : <p className="text-slate-400 text-sm">N/A</p>}
            </div>
          </div>
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
      setText(res.text || '')
    } catch (e) {
      setError(e?.message || 'AI request failed.')
    } finally {
      setLoading(false)
    }
  }, [task, context])

  // AI (Intelligence) is Admin-only - mirror the app's gating.
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

      {/* Loading */}
      {loading && (
        <div
          className="rounded-lg bg-white border border-slate-200 p-4 flex items-center gap-2.5 text-slate-500 text-sm"
          aria-label="Generating AI insight"
        >
          <Loader2 size={16} className="animate-spin text-slate-400" />
          Generating insight: KPIs, root cause and a recommendation...
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg bg-white border border-red-200 p-3 flex items-start gap-2 text-sm text-red-600">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div>
            <p>{error}</p>
            <button
              onClick={() => run()}
              className="mt-1 text-xs underline text-slate-600 hover:text-slate-900"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Placeholder (no result yet) */}
      {!loading && !error && !text && (
        <div className="rounded-lg bg-white border border-slate-200 border-dashed p-4 text-center">
          <Sparkles size={16} className="mx-auto mb-1.5 text-slate-300" />
          <p className="text-sm text-slate-500">
            Ask a question to get KPIs, root cause and a recommendation.
          </p>
          <button
            onClick={() => run()}
            className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline"
          >
            Generate insight
          </button>
        </div>
      )}

      {/* Result */}
      {!loading && !error && text && (
        <>
          <AiResult text={text} />
          <p className="mt-2 text-[10px] text-[var(--text-muted)]">
            AI-generated from record data; verify before acting. Repeated views use a cached response.
          </p>
        </>
      )}
    </div>
  )
}
