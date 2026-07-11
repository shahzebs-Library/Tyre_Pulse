import { useState, useCallback } from 'react'
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Download, ChevronDown,
  Info, ShieldAlert, Wrench,
} from 'lucide-react'

/**
 * IntakeDiagnosticsPanel — presentational diagnostics surface for the Data
 * Intake Center. Pure/stateless with respect to data: it renders the already
 * computed output of the diagnostics engine (src/lib/import/diagnostics.js)
 * passed via props. No fetching, no side effects beyond local expand/collapse
 * UI state. Dark/light-theme-safe through CSS custom properties.
 *
 * Modes:
 *   · 'validate' → pre-commit health, action plan, blocking errors, warnings.
 *   · 'result'   → post-commit outcome, stat row, failed-row groups, hints.
 *   · 'batch'    → batch-health checklist (+ optional meta summary line).
 *
 * Every array/object access is guarded so partial/empty props never crash.
 */

/* ── level → visual mapping ──────────────────────────────────────────────── */
const LEVEL_META = {
  ok: {
    Icon: CheckCircle2,
    icon: 'text-green-400',
    text: 'text-green-300',
    chip: 'bg-green-900/30 text-green-300',
    row: 'bg-green-900/10 border-green-700/30',
  },
  warn: {
    Icon: AlertTriangle,
    icon: 'text-amber-400',
    text: 'text-amber-300',
    chip: 'bg-amber-900/30 text-amber-300',
    row: 'bg-amber-900/10 border-amber-700/30',
  },
  error: {
    Icon: XCircle,
    icon: 'text-red-400',
    text: 'text-red-300',
    chip: 'bg-red-900/30 text-red-300',
    row: 'bg-red-900/10 border-red-700/30',
  },
}
const levelMeta = (level) => LEVEL_META[level] || LEVEL_META.ok

const asArray = (v) => (Array.isArray(v) ? v : [])
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const fmt = (v) => num(v).toLocaleString('en-US')

/* ── small building blocks ───────────────────────────────────────────────── */

function CheckRow({ check }) {
  const meta = levelMeta(check?.level)
  const Icon = meta.Icon
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${meta.row}`}>
      <Icon size={16} className={`shrink-0 mt-0.5 ${meta.icon}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">{check?.title || '—'}</p>
        {check?.detail && <p className="text-xs text-[var(--text-secondary)] mt-0.5">{check.detail}</p>}
        {check?.hint && (
          <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-start gap-1">
            <Info size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>{check.hint}</span>
          </p>
        )}
      </div>
    </div>
  )
}

function Checklist({ checks, emptyLabel = 'No diagnostics available.' }) {
  const list = asArray(checks)
  if (!list.length) {
    return <p className="text-xs text-[var(--text-muted)]">{emptyLabel}</p>
  }
  return (
    <div className="space-y-2">
      {list.map((c, i) => <CheckRow key={c?.id || i} check={c} />)}
    </div>
  )
}

function Pill({ label, value, tone = 'muted' }) {
  const tones = {
    green: 'bg-green-900/30 text-green-300',
    sky: 'bg-sky-900/30 text-sky-300',
    red: 'bg-red-900/30 text-red-300',
    amber: 'bg-amber-900/30 text-amber-300',
    muted: 'bg-[var(--surface-2)] text-[var(--text-secondary)]',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${tones[tone] || tones.muted}`}>
      {fmt(value)} {label}
    </span>
  )
}

function Stat({ label, value, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{fmt(value)}</p>
    </div>
  )
}

function SuccessBar({ rate }) {
  const pct = Math.max(0, Math.min(100, num(rate)))
  const color = pct >= 90 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'
  const textColor = pct >= 90 ? 'text-green-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400'
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-[var(--text-muted)]">Success rate</span>
        <span className={`text-xs font-semibold ${textColor}`}>{pct}%</span>
      </div>
      <div
        className="w-full bg-[var(--surface-2)] rounded h-1.5 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Commit success rate"
      >
        <div className={`${color} h-1.5 rounded transition-all`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  )
}

/* Expandable issue rows (blocking / warnings) keyed by import code. */
function IssueTable({ title, issues, tone, openSet, toggle, emptyLabel, emptyTone = 'ok' }) {
  const list = asArray(issues)
  const HeaderIcon = tone === 'error' ? XCircle : AlertTriangle
  const headTone = tone === 'error' ? 'text-red-400' : 'text-amber-400'

  if (!list.length) {
    const meta = levelMeta(emptyTone)
    const EmptyIcon = meta.Icon
    return (
      <div>
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
          <HeaderIcon size={13} className={headTone} aria-hidden="true" /> {title}
        </p>
        <p className={`text-sm flex items-center gap-2 ${meta.text}`}>
          <EmptyIcon size={15} className={meta.icon} aria-hidden="true" /> {emptyLabel}
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
        <HeaderIcon size={13} className={headTone} aria-hidden="true" /> {title} <span className="text-[var(--text-dim)]">({list.length})</span>
      </p>
      <div className="border border-[var(--border-dim)] rounded-xl overflow-hidden divide-y divide-[var(--border-dim)]">
        {list.map((it, i) => {
          const key = it?.code || `${title}-${i}`
          const isOpen = openSet.has(key)
          const samples = asArray(it?.sampleRows)
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-2)] transition-colors"
              >
                <ChevronDown
                  size={14}
                  className={`shrink-0 text-[var(--text-muted)] transition-transform ${isOpen ? '' : '-rotate-90'}`}
                  aria-hidden="true"
                />
                <span className="text-sm text-[var(--text-primary)] font-medium truncate">{it?.label || it?.code || 'Issue'}</span>
                {it?.field && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-secondary)] font-mono shrink-0">
                    {it.field}
                  </span>
                )}
                <span className="ml-auto shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded ${tone === 'error' ? 'bg-red-900/30 text-red-300' : 'bg-amber-900/30 text-amber-300'}`}>
                    {fmt(it?.count)}
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pl-9 space-y-1.5 bg-[var(--surface-1)]/40">
                  {it?.hint && (
                    <p className="text-xs text-[var(--text-secondary)] flex items-start gap-1.5">
                      <Info size={12} className="shrink-0 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
                      <span>{it.hint}</span>
                    </p>
                  )}
                  {samples.length > 0 && (
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Sample rows:{' '}
                      {samples.slice(0, 25).map((r, j) => (
                        <span key={j} className="font-mono text-[var(--text-secondary)]">
                          {j > 0 ? ', ' : ''}#{r}
                        </span>
                      ))}
                      {samples.length > 25 && <span className="text-[var(--text-dim)]"> …+{samples.length - 25} more</span>}
                    </p>
                  )}
                  {!it?.hint && !samples.length && (
                    <p className="text-[11px] text-[var(--text-dim)]">No further detail available.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── mode: validate ──────────────────────────────────────────────────────── */
function ValidateBody({ validation, actions, openSet, toggle }) {
  const v = validation || {}
  const counts = v.counts || {}
  const plan = v.plan || {}
  const forced = num(v.forcedThrough)
  const errorCount = num(counts.error)
  const canForce = !!actions?.canForce

  return (
    <div className="space-y-5">
      {/* Health checklist */}
      <div>
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">Health checks</p>
        <Checklist checks={v.health} emptyLabel="No health signals computed for this batch yet." />
      </div>

      {/* Action plan */}
      <div>
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">Action plan</p>
        <div className="flex flex-wrap items-center gap-2">
          <Pill label="insert" value={plan.insert} tone="green" />
          <Pill label="update" value={plan.update} tone="sky" />
          <Pill label="skip" value={plan.skip} tone="muted" />
          <Pill label="reject" value={plan.reject} tone="red" />
          {num(plan.review) > 0 && <Pill label="review" value={plan.review} tone="amber" />}
          {num(plan.overridden) > 0 && <Pill label="overridden" value={plan.overridden} tone="amber" />}
          {forced > 0 && <Pill label="forced through" value={forced} tone="amber" />}
        </div>
      </div>

      {/* Blocking errors */}
      <IssueTable
        title="Blocking errors"
        tone="error"
        issues={v.blocking}
        openSet={openSet}
        toggle={toggle}
        emptyLabel="No blocking errors — this batch can be committed."
        emptyTone="ok"
      />

      {/* Warnings */}
      <IssueTable
        title="Warnings"
        tone="warn"
        issues={v.warnings}
        openSet={openSet}
        toggle={toggle}
        emptyLabel="No warnings raised."
        emptyTone="ok"
      />

      {/* Elevated force/skip/reset controls */}
      {actions && errorCount > 0 && (
        <div className="bg-amber-900/15 border border-amber-700/40 rounded-xl p-4 space-y-3">
          <p className="text-sm text-amber-300 flex items-center gap-2">
            <ShieldAlert size={15} className="shrink-0" aria-hidden="true" />
            {fmt(errorCount)} error row(s) detected — choose how to resolve them before committing.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canForce && (
              <button
                type="button"
                onClick={() => actions.onForceErrors?.()}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-sm"
              >
                <ShieldAlert size={13} aria-hidden="true" /> Force-include error rows
              </button>
            )}
            <button
              type="button"
              onClick={() => actions.onSkipErrors?.()}
              className="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-secondary)] text-xs flex items-center gap-1.5"
            >
              <XCircle size={13} aria-hidden="true" /> Skip error rows
            </button>
            <button
              type="button"
              onClick={() => actions.onReset?.()}
              className="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-secondary)] text-xs flex items-center gap-1.5"
            >
              <Wrench size={13} aria-hidden="true" /> Reset to smart defaults
            </button>
          </div>
          {canForce && (
            <p className="text-[11px] text-amber-300/80">
              Forcing bypasses validation: flagged rows are pushed to the commit and may still fail their own
              per-row insert. Elevated approvers only — every override is audited.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── mode: result ────────────────────────────────────────────────────────── */
function ResultBody({ commit, openSet, toggle }) {
  const c = commit || {}
  const meta = levelMeta(c.level)
  const HeadIcon = meta.Icon
  const groups = asArray(c.errorGroups)
  const hints = asArray(c.hints)

  return (
    <div className="space-y-5">
      {/* Stalled banner */}
      {c.stalled && (
        <div className="bg-red-900/25 border border-red-700/60 rounded-xl p-4 flex items-start gap-2.5 text-red-300">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">Commit stalled</p>
            <p className="text-xs text-red-200/90 mt-0.5">
              The commit did not run to completion. Re-run it — already committed rows are skipped automatically.
            </p>
          </div>
        </div>
      )}

      {/* Headline */}
      <div className={`rounded-xl border px-4 py-3 flex items-start gap-2.5 ${meta.row}`}>
        <HeadIcon size={18} className={`shrink-0 mt-0.5 ${meta.icon}`} aria-hidden="true" />
        <div>
          <p className={`text-sm font-semibold ${meta.text}`}>{c.headline || `Status: ${c.status || 'unknown'}`}</p>
          {c.partial && (
            <p className="text-xs text-amber-300/90 mt-0.5">Partial commit — some rows were not committed.</p>
          )}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Stat label="Inserted" value={c.inserted} tone="text-green-400" />
        <Stat label="Skipped" value={c.skipped} tone="text-[var(--text-secondary)]" />
        <Stat label="Failed" value={c.failed} tone="text-red-400" />
        <Stat label="Merged" value={c.merged} tone="text-sky-400" />
        <Stat label="Enriched" value={c.enriched} tone="text-purple-400" />
        <SuccessBar rate={c.successRate} />
      </div>

      {/* Failed rows grouped by message */}
      {groups.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
            <XCircle size={13} className="text-red-400" aria-hidden="true" /> Failed rows
            <span className="text-[var(--text-dim)]">({groups.length} reason{groups.length !== 1 ? 's' : ''})</span>
          </p>
          <div className="border border-[var(--border-dim)] rounded-xl overflow-hidden divide-y divide-[var(--border-dim)]">
            {groups.map((g, i) => {
              const key = `grp-${i}-${g?.message || ''}`
              const isOpen = openSet.has(key)
              const rows = asArray(g?.rows)
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-2)] transition-colors"
                  >
                    <ChevronDown
                      size={14}
                      className={`shrink-0 text-[var(--text-muted)] transition-transform ${isOpen ? '' : '-rotate-90'}`}
                      aria-hidden="true"
                    />
                    <span className="text-sm text-[var(--text-primary)] truncate">{g?.message || 'Unknown error'}</span>
                    <span className="ml-auto shrink-0 text-xs px-2 py-0.5 rounded bg-red-900/30 text-red-300">{fmt(g?.count)}</span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 pl-9 bg-[var(--surface-1)]/40">
                      {rows.length ? (
                        <p className="text-[11px] text-[var(--text-muted)]">
                          Rows:{' '}
                          {rows.slice(0, 40).map((r, j) => (
                            <span key={j} className="font-mono text-[var(--text-secondary)]">{j > 0 ? ', ' : ''}#{r}</span>
                          ))}
                          {rows.length > 40 && <span className="text-[var(--text-dim)]"> …+{rows.length - 40} more</span>}
                        </p>
                      ) : (
                        <p className="text-[11px] text-[var(--text-dim)]">No row numbers recorded for this group.</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Advisory hints */}
      {hints.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">Recommendations</p>
          <ul className="space-y-1.5">
            {hints.map((h, i) => (
              <li key={i} className="text-xs text-[var(--text-secondary)] flex items-start gap-2">
                <Info size={13} className="shrink-0 mt-0.5 text-sky-400" aria-hidden="true" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ── mode: batch ─────────────────────────────────────────────────────────── */
function BatchBody({ batchHealth, batchMeta }) {
  const meta = batchMeta || {}
  const hasMeta = meta && (meta.module || meta.country || meta.importStatus || meta.total != null || meta.imported != null)
  return (
    <div className="space-y-4">
      {hasMeta && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-secondary)] bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-lg px-3 py-2">
          {meta.module && <span className="capitalize text-[var(--text-primary)] font-medium">{meta.module}</span>}
          {meta.country && <><span className="text-[var(--text-dim)]">·</span><span>{meta.country}</span></>}
          {meta.importStatus && <><span className="text-[var(--text-dim)]">·</span><span className="px-1.5 py-0.5 rounded bg-[var(--surface-2)]">{meta.importStatus}</span></>}
          {(meta.imported != null || meta.total != null) && (
            <><span className="text-[var(--text-dim)]">·</span><span className="font-mono">{fmt(meta.imported)}/{fmt(meta.total)}</span> imported</>
          )}
        </div>
      )}
      <Checklist checks={batchHealth} emptyLabel="No batch health signals available." />
    </div>
  )
}

/* ── root component ──────────────────────────────────────────────────────── */
export default function IntakeDiagnosticsPanel({
  mode = 'validate',
  validation,
  commit,
  batchHealth,
  batchMeta,
  loading = false,
  error = null,
  onDownload,
  actions,
}) {
  const [openSet, setOpenSet] = useState(() => new Set())
  const toggle = useCallback((key) => {
    setOpenSet((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--card-border)]">
        <Activity size={16} className="text-[var(--accent)]" aria-hidden="true" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Diagnostics</span>
        <span className="ml-auto" />
        {typeof onDownload === 'function' && (
          <button
            type="button"
            onClick={() => onDownload()}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title="Download diagnostics report"
          >
            <Download size={13} aria-hidden="true" /> Download
          </button>
        )}
      </div>

      <div className="p-4">
        {/* Error row */}
        {error && (
          <div className="mb-4 flex items-center gap-2 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2">
            <XCircle size={15} className="shrink-0" aria-hidden="true" /> {String(error)}
          </div>
        )}

        {/* Loading spinner row */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-2" role="status" aria-live="polite">
            <span className="inline-block w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            Running diagnostics…
          </div>
        ) : (
          <>
            {mode === 'validate' && (
              <ValidateBody validation={validation} actions={actions} openSet={openSet} toggle={toggle} />
            )}
            {mode === 'result' && (
              <ResultBody commit={commit} openSet={openSet} toggle={toggle} />
            )}
            {mode === 'batch' && (
              <BatchBody batchHealth={batchHealth} batchMeta={batchMeta} />
            )}
            {mode !== 'validate' && mode !== 'result' && mode !== 'batch' && (
              <p className="text-xs text-[var(--text-muted)]">Unknown diagnostics mode: {String(mode)}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
