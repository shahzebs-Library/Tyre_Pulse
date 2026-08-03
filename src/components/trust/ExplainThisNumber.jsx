/**
 * ExplainThisNumber - the "why is this figure what it is" trigger (V473).
 *
 * A KPI value on a dashboard is an assertion. This is the receipt behind it:
 * one governed definition, its versioned formula, where the data comes from,
 * the exact filters applied, and how fresh it is. It drops next to any figure
 * as a small unobtrusive Info button and opens a modal that reads the shaped
 * explain_metric payload.
 *
 * Theme-aware by construction: every surface uses var(--*) tokens so it reads
 * on both light and dark. Never a hardcoded slate/zinc/black. Honest N/A for
 * any field the registry does not carry - a blank is not a zero and a missing
 * definition is not an empty one. ASCII only (no em/en dashes or arrows).
 *
 * Usage:
 *   <ExplainThisNumber metricId="fleet_cpk" value="SAR 0.84" label="Fleet CPK"
 *     country={country} from={from} to={to} />
 */
import { useCallback, useEffect, useState } from 'react'
import { Info, X, RefreshCw, Database, Clock, GitBranch, Layers } from 'lucide-react'
import { explainMetric } from '../../lib/api/metricRegistry'
import { shapeExplain, EXPLAIN_SECTIONS, fmtList } from '../../lib/metricExplain'
import { toUserMessage } from '../../lib/safeError'

/* A value the registry did not carry reads N/A - never a blank or a fabricated 0. */
const na = (v) => (v === null || v === undefined || v === '' ? 'N/A' : String(v))

/* One labelled fact. The label is muted, the value carries the weight. */
function Field({ label, value, mono = false, full = false }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <dt
        className="text-[11px] uppercase tracking-wide mb-0.5"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </dt>
      <dd
        className={`text-sm break-words ${mono ? 'font-mono text-xs' : ''}`}
        style={{ color: 'var(--text-primary)' }}
      >
        {na(value)}
      </dd>
    </div>
  )
}

/* A grouped section with a heading icon. Deliberately quiet dividers. */
function Section({ icon: Icon, title, children }) {
  return (
    <section
      className="rounded-lg border p-3"
      style={{ background: 'var(--input-bg)', borderColor: 'var(--card-border)' }}
    >
      <h4
        className="flex items-center gap-1.5 text-xs font-semibold mb-2.5"
        style={{ color: 'var(--text-secondary)' }}
      >
        {Icon && <Icon size={13} style={{ color: 'var(--accent)' }} />}
        {title}
      </h4>
      {children}
    </section>
  )
}

/* Render an arbitrary lineage json object as labelled rows. The payload shape is
   not fixed (it is a per-source provenance stat block), so we walk its keys and
   stringify nested values readably rather than assuming a schema. */
function stringifyLineageValue(v) {
  if (v === null || v === undefined) return 'N/A'
  if (Array.isArray(v)) return v.length ? v.map(stringifyLineageValue).join(', ') : 'N/A'
  if (typeof v === 'object') {
    const parts = Object.entries(v).map(([k, val]) => `${humanKey(k)}: ${stringifyLineageValue(val)}`)
    return parts.length ? parts.join('; ') : 'N/A'
  }
  return String(v)
}

function humanKey(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function LineageBlock({ lineage }) {
  if (!lineage || typeof lineage !== 'object') {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        No lineage recorded for this metric yet.
      </p>
    )
  }
  const entries = Object.entries(lineage)
  if (!entries.length) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        No lineage recorded for this metric yet.
      </p>
    )
  }
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-col sm:flex-row sm:gap-2">
          <span
            className="text-[11px] uppercase tracking-wide shrink-0 sm:w-40"
            style={{ color: 'var(--text-muted)' }}
          >
            {humanKey(k)}
          </span>
          <span className="text-xs break-words" style={{ color: 'var(--text-primary)' }}>
            {stringifyLineageValue(v)}
          </span>
        </div>
      ))}
    </div>
  )
}

/* Fresh / Stale / Unknown badge, driven only by freshness.stale (never guessed). */
function FreshnessBadge({ stale }) {
  const map = stale === true
    ? { text: 'Stale', bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b', bd: 'rgba(245,158,11,0.4)' }
    : stale === false
      ? { text: 'Fresh', bg: 'rgba(16,185,129,0.15)', fg: '#10b981', bd: 'rgba(16,185,129,0.4)' }
      : { text: 'Unknown', bg: 'var(--input-bg)', fg: 'var(--text-muted)', bd: 'var(--card-border)' }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium"
      style={{ background: map.bg, color: map.fg, borderColor: map.bd }}
    >
      {map.text}
    </span>
  )
}

export default function ExplainThisNumber({
  metricId,
  country = null,
  from = null,
  to = null,
  value = null,
  label = null,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState({ loading: false, error: null, data: null })

  const load = useCallback(async () => {
    if (!metricId) {
      setState({ loading: false, error: 'No metric was specified for this figure.', data: null })
      return
    }
    setState({ loading: true, error: null, data: null })
    try {
      const raw = await explainMetric(metricId, { country, from, to })
      const shaped = shapeExplain(raw)
      if (!shaped) {
        setState({
          loading: false,
          error: 'No governed definition is available for this metric yet.',
          data: null,
        })
        return
      }
      setState({ loading: false, error: null, data: shaped })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), data: null })
    }
  }, [metricId, country, from, to])

  // Load when the modal opens, and re-load if the filters change while open.
  useEffect(() => {
    if (open) load()
  }, [open, load])

  // Close on Escape while the modal is open.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const filtersLabel = [
    country ? `Country: ${country}` : null,
    from ? `From: ${from}` : null,
    to ? `To: ${to}` : null,
  ].filter(Boolean).join('  |  ') || 'No filters applied (all data)'

  const d = state.data
  const m = d?.metric || null
  const v = d?.version || null
  const fr = d?.freshness || null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Explain this number"
        title="Explain this number"
        className={`inline-flex items-center justify-center h-5 w-5 rounded border transition-colors align-middle ${className}`}
        style={{
          background: 'var(--input-bg)',
          borderColor: 'var(--card-border)',
          color: 'var(--text-muted)',
        }}
      >
        <Info size={12} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Explain this number"
            className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border shadow-2xl"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
          >
            {/* header */}
            <header
              className="flex items-start gap-3 px-5 py-3.5 border-b shrink-0"
              style={{ borderColor: 'var(--card-border)' }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Explain this number
                </p>
                <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {label || m?.name || metricId || 'Metric'}
                </h3>
                {value !== null && value !== undefined && (
                  <p className="text-lg font-semibold tabular-nums mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    {String(value)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1 rounded shrink-0 transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={16} />
              </button>
            </header>

            {/* body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {state.loading && (
                <div className="py-10 text-center" role="status" aria-label="Loading">
                  <RefreshCw size={20} className="mx-auto animate-spin" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                    Reading the governed definition...
                  </p>
                </div>
              )}

              {!state.loading && state.error && (
                <div
                  className="rounded-lg border p-4 text-center"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--card-border)' }}
                >
                  <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>{state.error}</p>
                  <button
                    type="button"
                    onClick={load}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors"
                    style={{ borderColor: 'var(--card-border)', color: 'var(--text-primary)' }}
                  >
                    <RefreshCw size={13} /> Retry
                  </button>
                </div>
              )}

              {!state.loading && !state.error && d && (
                <>
                  {/* Definition */}
                  <Section title={EXPLAIN_SECTIONS.find((s) => s.key === 'definition')?.label || 'Definition'}>
                    {m?.description && (
                      <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>{m.description}</p>
                    )}
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                      <Field label="Name" value={m?.name} />
                      <Field label="Metric ID" value={m?.id} mono />
                      <Field label="Business owner" value={m?.owner} />
                      <Field label="Unit" value={m?.unit} />
                      <Field label="Currency handling" value={m?.currencyHandling} full />
                    </dl>
                  </Section>

                  {/* Formula & version */}
                  <Section
                    icon={GitBranch}
                    title={EXPLAIN_SECTIONS.find((s) => s.key === 'formula')?.label || 'Formula & version'}
                  >
                    {v ? (
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                        <Field label="Formula" value={v.formula} mono full />
                        <Field label="Formula version" value={v.version} />
                        <Field label="Rounding" value={v.rounding} />
                        <Field label="Numerator" value={v.numerator} mono full />
                        <Field label="Denominator" value={v.denominator} mono full />
                        <Field label="Effective from" value={v.effectiveFrom} />
                        <Field label="Owner" value={v.owner} />
                        <Field label="Approver" value={v.approver} />
                        <Field label="Approved at" value={v.approvedAt} />
                        <Field label="Change note" value={v.changeNote} full />
                      </dl>
                    ) : (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        No approved formula version is recorded for this metric yet.
                      </p>
                    )}
                  </Section>

                  {/* Source & lineage */}
                  <Section
                    icon={Layers}
                    title={EXPLAIN_SECTIONS.find((s) => s.key === 'source')?.label || 'Source & lineage'}
                  >
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 mb-3">
                      <Field label="Source module" value={m?.sourceModule} />
                      <Field label="Source table" value={m?.sourceTable} mono />
                      <Field label="Source columns" value={fmtList(m?.sourceColumns)} mono full />
                      <Field label="Joins" value={m?.joins} full />
                      <Field label="Transformations" value={m?.transformations} full />
                      <Field label="Calc reference" value={m?.calcRef} mono full />
                    </dl>
                    <div
                      className="pt-3 border-t"
                      style={{ borderColor: 'var(--card-border)' }}
                    >
                      <p
                        className="text-[11px] uppercase tracking-wide mb-2"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        Lineage
                      </p>
                      <LineageBlock lineage={d.lineage} />
                    </div>
                  </Section>

                  {/* Filters & rules */}
                  <Section title={EXPLAIN_SECTIONS.find((s) => s.key === 'filters')?.label || 'Filters & rules'}>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                      <Field label="Date field" value={m?.dateField} mono />
                      <Field label="Date logic" value={m?.dateLogic} />
                      <Field label="Included statuses" value={fmtList(m?.included)} full />
                      <Field label="Excluded statuses" value={fmtList(m?.excluded)} full />
                      <Field label="Null handling" value={m?.nullHandling} full />
                      <Field label="Duplicate handling" value={m?.duplicateHandling} full />
                      <Field label="Current filters" value={filtersLabel} full />
                    </dl>
                  </Section>

                  {/* Freshness */}
                  <Section
                    icon={Clock}
                    title={EXPLAIN_SECTIONS.find((s) => s.key === 'freshness')?.label || 'Freshness'}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Data status</span>
                      <FreshnessBadge stale={fr?.stale} />
                      {fr?.ageHours !== null && fr?.ageHours !== undefined && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          about {Math.round(fr.ageHours)} h since last arrival
                        </span>
                      )}
                    </div>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                      <Field label="Source table" value={fr?.sourceTable} mono />
                      <Field
                        label="Source row count"
                        value={fr?.rowCount === null || fr?.rowCount === undefined
                          ? null
                          : fr.rowCount.toLocaleString('en-US')}
                      />
                      <Field label="Last source update" value={fr?.lastSourceUpdate} />
                      <Field label="Last calculation" value={fr?.lastCalculation} />
                      <Field label="Refresh SLA" value={fr?.refreshSla || m?.refreshSla} full />
                    </dl>
                  </Section>

                  {/* Records */}
                  <Section
                    icon={Database}
                    title={EXPLAIN_SECTIONS.find((s) => s.key === 'provenance')?.label || 'Records'}
                  >
                    <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                      Record-level provenance (import batch, source file and load history) is
                      available by drilling into an individual row from its source table.
                    </p>
                    {Array.isArray(d.lineage?.sources) && d.lineage.sources.length > 0 ? (
                      <div className="space-y-1.5">
                        {d.lineage.sources.map((s, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between rounded border px-2.5 py-1.5"
                            style={{ background: 'var(--input-bg)', borderColor: 'var(--card-border)' }}
                          >
                            <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
                              {na(s.table || s.source_table || s.name)}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {stringifyLineageValue({ ...s, table: undefined, source_table: undefined, name: undefined })}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        No per-source record breakdown is exposed for this metric.
                      </p>
                    )}
                  </Section>

                  {m?.dashboards && m.dashboards.length > 0 && (
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Used on: {fmtList(m.dashboards)}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* footer */}
            <footer
              className="flex justify-end px-5 py-3 border-t shrink-0"
              style={{ borderColor: 'var(--card-border)' }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded-lg border text-xs transition-colors"
                style={{ borderColor: 'var(--card-border)', color: 'var(--text-primary)' }}
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
