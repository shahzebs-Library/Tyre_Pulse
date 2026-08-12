/**
 * ReplacementPanel - what a machine on the disposal list would cost to replace,
 * and what has already been spent against that price.
 *
 * Every valuation slot in this module printed "Not valued", because nothing in
 * the data supported a figure. A supplier quotation is the first hard price the
 * fleet has, and it turns "this pump has cost us a lot" into "this pump has cost
 * us N% of a new one" - a fact a committee can act on.
 *
 * THREE THINGS THIS PANEL WILL NOT DO, because each one would print a number
 * that looks authoritative and is not:
 *
 *  1. It does not spread a quotation across asset classes. A pump price prices
 *     pumps. A machine whose class carries no quotation keeps its row with BLANK
 *     figures and the reason in place of them - never a nearest-thing price and
 *     never a zero.
 *  2. It does not annualise the replacement cost over an assumed service life,
 *     and it quotes no depreciation, resale or scrap value. Those numbers do not
 *     exist here, and the assumed life would be the largest term in any of them.
 *  3. It does not present the exposure figure as the cost of replacing the list.
 *     It covers the PRICED machines only, and the unpriced count sits beside it.
 *
 * An expired quotation is shown with its lapsed badge. It is still the best
 * evidence available; it is simply not today's price, and the badge says so.
 *
 * All arithmetic is the pure `assetReplacement` engine. Nothing is recomputed
 * here: a value the engine returns as null renders blank, which is not zero.
 */
import { useMemo, useState, useCallback } from 'react'
import {
  Banknote, FileText, Info, Lightbulb, AlertTriangle, Loader2, Save, Trash2,
  Plus, Pencil, FileSpreadsheet, Percent,
} from 'lucide-react'
import Modal from '../ui/Modal'
import {
  replacementTotals, replacementFindings, replacementExportRows,
  benchmarkStatusMeta,
} from '../../lib/assetReplacement'
import { saveReplacementBenchmark, deleteReplacementBenchmark } from '../../lib/api/assetDisposals'
import { exportToExcel, reportFileName, reportDateLabel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

const NOT_PRICED = ''

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))

const fmtNum = (v, digits = 0) => (isNum(v)
  ? Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })
  : NOT_PRICED)

const fmtPct = (v) => (isNum(v) ? `${Number(v).toFixed(1)}%` : NOT_PRICED)

const fmtMoney = (v, currency) => (isNum(v)
  ? `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency || ''}`.trim()
  : NOT_PRICED)

const fmtDate = (v) => (v ? String(v).slice(0, 10) : NOT_PRICED)

const TONE_TEXT = {
  danger: 'text-red-300',
  warning: 'text-amber-300',
  good: 'text-emerald-300',
  info: 'text-sky-300',
  quiet: 'text-[var(--text-secondary)]',
}

const TONE_DOT = {
  danger: 'bg-red-400',
  warning: 'bg-amber-400',
  good: 'bg-emerald-400',
  info: 'bg-sky-400',
  quiet: 'bg-slate-400',
}

const TONE_BADGE = {
  danger: 'bg-red-500/15 text-red-300 border-red-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  quiet: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

/** The engine's own four level ladder, so the panel cannot rename it. */
const PRIORITY_TONE = {
  critical: 'danger', high: 'warning', medium: 'info', info: 'quiet',
}
const PRIORITY_LABEL = {
  critical: 'Act now', high: 'High', medium: 'Medium', info: 'For information',
}

const inputCls = 'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500'

const EXPORT_COLUMNS = [
  ['asset_no', 'Asset'],
  ['asset_type', 'Asset class'],
  ['maintenance_spend', 'Maintenance spend'],
  ['replacement_ex_vat', 'New machine (ex-VAT)'],
  ['replacement_with_vat', 'New machine (with VAT)'],
  ['currency', 'Currency'],
  ['spend_pct_of_new', 'Spend as % of a new machine'],
  ['last_complete_year', 'Last complete year'],
  ['last_year_spend', 'Spend in that year'],
  ['years_of_spend_per_new_machine', 'Years of spend per new machine'],
  ['quotation', 'Quotation'],
  ['supplier', 'Supplier'],
  ['quotation_date', 'Quoted'],
  ['quotation_valid_until', 'Valid until'],
  ['quotation_status', 'Quotation status'],
  ['source_document', 'Source document'],
  ['note', 'Note'],
]

function Tile({ label, value, sub, tone = 'quiet', icon: Icon }) {
  return (
    <div className="card">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {Icon && <Icon size={13} />} {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${TONE_TEXT[tone] || 'text-[var(--text-primary)]'}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</div>}
    </div>
  )
}

function Badge({ tone, label, className = '' }) {
  if (!label) return null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${TONE_BADGE[tone] || TONE_BADGE.quiet} ${className}`}>
      {label}
    </span>
  )
}

/** The whole exposure statement, or the reason it cannot be stated as one figure. */
function exposureText(exposure) {
  if (!exposure) return { value: 'Not priced', sub: 'No machine on this list carries a supplier quotation.' }
  if (exposure.mixedCurrency) {
    const parts = Object.entries(exposure.byCurrency || {})
      .map(([cur, amt]) => `${Number(amt).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${cur}`)
    return {
      value: 'Mixed currencies',
      sub: `Not summed across currencies: ${parts.join(', ')}.`,
    }
  }
  if (!isNum(exposure.total)) {
    return { value: 'Not priced', sub: 'No machine on this list carries a supplier quotation.' }
  }
  return {
    value: fmtMoney(exposure.total, exposure.currency),
    sub: `Ex-VAT, over the ${exposure.counted} machines a quotation covers. VAT is recoverable and is not a cost.`,
  }
}

export default function ReplacementPanel({
  rows = [],
  benchmarks = null,
  benchmarksRaw = null,
  currency = '',
  canEdit = false,
  onSaved = null,
}) {
  const [editing, setEditing] = useState(null)   // benchmark open in the editor
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Every figure follows the rows ON SCREEN. Quoting register-wide totals over a
  // filtered table is how somebody reads out a number that is not in front of them.
  const totals = useMemo(() => replacementTotals(rows, benchmarks, { now: Date.now() }), [rows, benchmarks])
  const findings = useMemo(
    () => replacementFindings(rows, benchmarks, { now: Date.now(), currency: currency || 'SAR' }),
    [rows, benchmarks, currency],
  )
  const quotations = useMemo(() => {
    const list = Array.isArray(benchmarksRaw) ? benchmarksRaw : []
    return [...list].sort((a, b) => String(a?.asset_type || '').localeCompare(String(b?.asset_type || '')))
  }, [benchmarksRaw])

  // A class with no machine on the list can still be priced, so the picker offers
  // the classes in front of the user AND accepts anything typed.
  const classOptions = useMemo(
    () => [...new Set(rows.map((r) => String(r?.asset_type || '').trim().toUpperCase()).filter(Boolean))].sort(),
    [rows],
  )

  const exposure = exposureText(totals.exposure)

  const doExport = useCallback(async () => {
    const objects = replacementExportRows(rows, benchmarks, { now: Date.now() })
    const name = reportFileName('Asset Replacement Cost', reportDateLabel())
    await exportToExcel(
      objects,
      EXPORT_COLUMNS.map(([k]) => k),
      EXPORT_COLUMNS.map(([, h]) => h),
      name,
      'Replacement',
      { title: 'Replacement cost against maintenance spend', currency: currency || 'SAR' },
    )
  }, [rows, benchmarks, currency])

  const save = useCallback(async (form) => {
    setBusy(true)
    setError('')
    try {
      await saveReplacementBenchmark(form)
      setEditing(null)
      if (onSaved) await onSaved()
    } catch (e) {
      setError(toUserMessage(e))
    } finally { setBusy(false) }
  }, [onSaved])

  const remove = useCallback(async (row) => {
    if (!row?.id) return
    setBusy(true)
    setError('')
    try {
      await deleteReplacementBenchmark(row.id)
      setEditing(null)
      if (onSaved) await onSaved()
    } catch (e) {
      setError(toUserMessage(e))
    } finally { setBusy(false) }
  }, [onSaved])

  return (
    <div className="space-y-4">
      {error && (
        <div className="card border border-red-800/50 flex items-start gap-2">
          <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* ── Headline strip ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Replacement cost, priced machines"
          value={exposure.value}
          sub={exposure.sub}
          tone={isNum(totals.exposure?.total) ? 'info' : 'quiet'}
          icon={Banknote}
        />
        <Tile
          label="Machines with a price"
          value={`${totals.coveredCount} of ${totals.rows.length}`}
          sub={isNum(totals.coveragePct)
            ? `${fmtPct(totals.coveragePct)} of this list is covered by a supplier quotation`
            : 'Nothing on this list to price'}
          tone={totals.uncoveredCount > 0 ? 'warning' : 'good'}
          icon={FileText}
        />
        <Tile
          label="Average spend against a new machine"
          value={isNum(totals.avgSpendPct) ? fmtPct(totals.avgSpendPct) : 'Not measured'}
          sub="Across the priced machines that carry a maintenance figure"
          tone={isNum(totals.avgSpendPct) && totals.avgSpendPct >= 100 ? 'danger' : 'quiet'}
          icon={Percent}
        />
        <Tile
          label="Prices on a lapsed quotation"
          value={totals.expiredCount}
          sub={totals.expiredCount > 0
            ? 'The last price the supplier put in writing. Requote before committing.'
            : 'Every price in use is inside its validity period'}
          tone={totals.expiredCount > 0 ? 'warning' : 'quiet'}
          icon={AlertTriangle}
        />
      </div>

      {/* The count that stops a partial exposure being read as the whole bill.
          It sits above everything, not in a footnote. */}
      {totals.unpricedNote && (
        <div className="card border border-amber-800/50 flex items-start gap-2">
          <Info size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-300">{totals.unpricedNote}</p>
        </div>
      )}

      {/* ── Findings ─────────────────────────────────────────────────────── */}
      {findings.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <Lightbulb size={15} />
            <span className="text-sm font-medium">What the replacement price says</span>
          </div>
          {findings.map((f) => {
            const tone = PRIORITY_TONE[f.priority] || 'quiet'
            return (
              <div key={f.key} className="flex items-start gap-2">
                <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${TONE_DOT[tone]}`} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{f.title}</p>
                    <Badge tone={tone} label={PRIORITY_LABEL[f.priority] || f.priority} />
                  </div>
                  {f.detail && <p className="text-sm text-[var(--text-secondary)] mt-0.5">{f.detail}</p>}
                  {Array.isArray(f.evidence) && f.evidence.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {f.evidence.map((e, i) => (
                        <li key={i} className="text-xs text-[var(--text-muted)]">{e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Per machine ──────────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-[var(--input-border)] flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-secondary)]">Spend against the cost of a new machine</span>
          <span className="text-xs text-[var(--text-muted)]">
            A machine whose class carries no quotation keeps its row and shows why. A blank is not a zero.
          </span>
          <button
            onClick={doExport}
            className="btn-secondary text-sm inline-flex items-center gap-1.5 ml-auto"
            disabled={!totals.rows.length}
          >
            <FileSpreadsheet size={14} /> Excel
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--input-bg)] text-[var(--text-muted)]">
              <tr>
                {[
                  'Asset', 'Class', 'Maintenance spend', 'New machine (ex-VAT)',
                  'Spend as % of new', 'Last complete year', 'Years of spend per new machine', 'Quotation',
                ].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totals.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[var(--text-muted)]">
                    No machines are in this selection.
                  </td>
                </tr>
              )}
              {totals.rows.map((p, i) => {
                const meta = p.status ? benchmarkStatusMeta(p.status) : null
                const heavy = isNum(p.spendPctOfNew) && p.spendPctOfNew >= 100
                return (
                  <tr key={`${p.assetNo || 'row'}-${i}`} className="border-t border-[var(--input-border)]">
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)] whitespace-nowrap">
                      {p.assetNo || NOT_PRICED}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{p.assetType || NOT_PRICED}</td>
                    <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
                      {fmtMoney(p.lifetimeSpend, p.currency || currency)}
                    </td>
                    {p.covered ? (
                      <>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
                          {fmtMoney(p.replacementCost, p.currency)}
                        </td>
                        <td className={`px-3 py-2 tabular-nums whitespace-nowrap ${heavy ? TONE_TEXT.danger : 'text-[var(--text-secondary)]'}`}>
                          {fmtPct(p.spendPctOfNew)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
                          {p.lastCompleteYear
                            ? `${p.lastCompleteYear.year}: ${fmtMoney(p.lastCompleteYear.spend, p.currency)}`
                            : NOT_PRICED}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
                          {isNum(p.yearsOfSpendPerNewMachine) ? `${fmtNum(p.yearsOfSpendPerNewMachine, 1)} years` : NOT_PRICED}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Badge tone={meta?.tone} label={meta?.label} />
                        </td>
                      </>
                    ) : (
                      // The reason takes the place of the figures. Blank cells with
                      // no explanation read as a broken table.
                      <td colSpan={5} className="px-3 py-2 text-[var(--text-muted)]">{p.reason}</td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">
          Prices are ex-VAT: the 15% VAT is recoverable and is not a cost to the business. The replacement cost is not
          spread over a service life, and no depreciation, resale or scrap value is quoted anywhere on this screen,
          because none of those figures exists in this data.
        </p>
      </div>

      {/* ── Supplier quotations ──────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-[var(--input-border)] flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-secondary)]">Supplier quotations</span>
          <span className="text-xs text-[var(--text-muted)]">
            One price per asset class. Where two quotations price the same class, the newest is used and the older one
            is left visible rather than deleted.
          </span>
          {canEdit && (
            <button
              onClick={() => setEditing({})}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 ml-auto"
            >
              <Plus size={14} /> Add quotation
            </button>
          )}
        </div>
        {quotations.length === 0 ? (
          <p className="px-3 py-6 text-sm text-[var(--text-muted)] text-center">
            No supplier quotation is on file. Until one is added, no machine on this list can be measured against the
            cost of a new one, and this module quotes no replacement figure at all.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--input-bg)] text-[var(--text-muted)]">
                <tr>
                  {[
                    'Class', 'Quotation', 'Supplier', 'Ex-VAT', 'VAT', 'Total', 'Quoted', 'Valid until',
                    'Status', 'Source document', canEdit ? '' : null,
                  ].filter((h) => h !== null).map((h, i) => (
                    <th key={h || `act-${i}`} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quotations.map((q) => {
                  // Status is read the same way the engine reads it, so a lapsed
                  // quotation is labelled identically on both surfaces.
                  const until = q?.valid_until ? new Date(q.valid_until) : null
                  const status = !until || Number.isNaN(until.getTime())
                    ? 'undated'
                    : (until.getTime() >= Date.now() ? 'current' : 'expired')
                  const meta = benchmarkStatusMeta(status)
                  const inactive = q?.active === false
                  return (
                    <tr key={q.id} className="border-t border-[var(--input-border)]">
                      <td className="px-3 py-2 font-medium text-[var(--text-primary)] whitespace-nowrap">{q.asset_type || NOT_PRICED}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">
                        {q.label || q.model || NOT_PRICED}
                        {q.spec && <span className="block text-xs text-[var(--text-muted)]">{q.spec}</span>}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{q.supplier || NOT_PRICED}</td>
                      <td className="px-3 py-2 tabular-nums text-[var(--text-primary)] whitespace-nowrap">{fmtMoney(q.unit_price, q.currency)}</td>
                      <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
                        {fmtMoney(q.vat_amount, q.currency)}
                        {isNum(q.vat_pct) && <span className="text-[var(--text-muted)]"> ({fmtPct(q.vat_pct)})</span>}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)] whitespace-nowrap">{fmtMoney(q.total_price, q.currency)}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(q.quote_date)}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(q.valid_until)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge tone={meta.tone} label={meta.label} />
                        {inactive && <Badge tone="quiet" label="Retired" className="ml-1" />}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)] text-xs">
                        {q.source_file || NOT_PRICED}
                        {q.quote_ref && <span className="block">Ref {q.quote_ref}</span>}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setEditing(q)}
                            className="text-blue-400 hover:underline inline-flex items-center gap-1 text-xs"
                          >
                            <Pencil size={13} /> Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-3 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">
          A lapsed quotation is kept and labelled. It is the last price the supplier put in writing, which is far
          better evidence than none, but it is not today&apos;s price and no purchase should be committed against it
          without a requote.
        </p>
      </div>

      {editing && (
        <BenchmarkEditor
          row={editing}
          busy={busy}
          classOptions={classOptions}
          defaultCurrency={currency || 'SAR'}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Quotation editor
 * ------------------------------------------------------------------ */

const EMPTY_FORM = {
  asset_type: '', label: '', supplier: '', model: '', spec: '',
  unit_price: '', vat_pct: '', vat_amount: '', total_price: '', currency: 'SAR',
  quote_ref: '', quote_date: '', valid_until: '', warranty_note: '',
  source_file: '', notes: '', active: true,
}

function BenchmarkEditor({ row, busy, classOptions, defaultCurrency, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    currency: defaultCurrency || 'SAR',
    ...Object.fromEntries(
      Object.keys(EMPTY_FORM)
        .filter((k) => row && row[k] !== null && row[k] !== undefined)
        .map((k) => [k, row[k]]),
    ),
  }))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const invalid = !String(form.asset_type || '').trim() || form.unit_price === '' || form.unit_price == null

  const submit = () => {
    if (invalid) return
    // An empty box means nobody entered a figure, which is a different statement
    // from zero, so it goes as null rather than as 0.
    const blankToNull = (v) => (v === '' || v == null ? null : v)
    onSave({
      ...(row?.id ? { id: row.id } : {}),
      asset_type: String(form.asset_type).trim().toUpperCase(),
      label: blankToNull(form.label),
      supplier: blankToNull(form.supplier),
      model: blankToNull(form.model),
      spec: blankToNull(form.spec),
      unit_price: form.unit_price,
      vat_pct: blankToNull(form.vat_pct),
      vat_amount: blankToNull(form.vat_amount),
      total_price: blankToNull(form.total_price),
      currency: String(form.currency || 'SAR').trim().toUpperCase(),
      quote_ref: blankToNull(form.quote_ref),
      quote_date: blankToNull(form.quote_date),
      valid_until: blankToNull(form.valid_until),
      warranty_note: blankToNull(form.warranty_note),
      source_file: blankToNull(form.source_file),
      notes: blankToNull(form.notes),
      active: form.active !== false,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={row?.id ? `Edit the quotation for ${row.asset_type || 'an asset class'}` : 'Add a supplier quotation'}
      subtitle="One price per asset class. The ex-VAT price is the cost basis for every ratio in this module; VAT is recoverable and is carried only because the document prints it."
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          {row?.id && (
            confirmDelete ? (
              <button
                onClick={() => onDelete(row)}
                className="btn-secondary text-sm text-red-300 inline-flex items-center gap-1.5"
                disabled={busy}
              >
                <Trash2 size={14} /> Confirm delete
              </button>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="btn-secondary text-sm inline-flex items-center gap-1.5 mr-auto"
                disabled={busy}
              >
                <Trash2 size={14} /> Delete
              </button>
            )
          )}
          <button onClick={onClose} className="btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button onClick={submit} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={busy || invalid}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Asset class (required)</span>
          <input
            list="replacement-asset-classes"
            value={form.asset_type}
            onChange={(e) => set('asset_type', e.target.value)}
            className={inputCls}
            placeholder="PUMPS"
          />
          <datalist id="replacement-asset-classes">
            {classOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
          <span className="block text-[11px] text-[var(--text-muted)]">
            A class with no machine on the list can still be priced. The price applies to this class and to no other.
          </span>
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Label</span>
          <input value={form.label} onChange={(e) => set('label', e.target.value)} className={inputCls} placeholder="47m truck mounted concrete pump" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Supplier</span>
          <input value={form.supplier} onChange={(e) => set('supplier', e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Model</span>
          <input value={form.model} onChange={(e) => set('model', e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
          <span>Specification</span>
          <input value={form.spec} onChange={(e) => set('spec', e.target.value)} className={inputCls} placeholder="As written on the quotation" />
        </label>

        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Unit price, ex-VAT (required, the cost basis)</span>
          <input type="number" value={form.unit_price} onChange={(e) => set('unit_price', e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Currency</span>
          <input value={form.currency} onChange={(e) => set('currency', e.target.value)} className={inputCls} placeholder="SAR" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>VAT percent</span>
          <input type="number" value={form.vat_pct} onChange={(e) => set('vat_pct', e.target.value)} className={inputCls} placeholder="15" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>VAT amount</span>
          <input type="number" value={form.vat_amount} onChange={(e) => set('vat_amount', e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Total price as printed</span>
          <input type="number" value={form.total_price} onChange={(e) => set('total_price', e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Quotation reference</span>
          <input value={form.quote_ref} onChange={(e) => set('quote_ref', e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Quoted on</span>
          <input type="date" value={String(form.quote_date || '').slice(0, 10)} onChange={(e) => set('quote_date', e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Valid until</span>
          <input type="date" value={String(form.valid_until || '').slice(0, 10)} onChange={(e) => set('valid_until', e.target.value)} className={inputCls} />
          <span className="block text-[11px] text-[var(--text-muted)]">
            Leave blank if the document carries no validity date. A quotation past this date is kept and labelled as
            lapsed, never hidden.
          </span>
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
          <span>Warranty</span>
          <input value={form.warranty_note} onChange={(e) => set('warranty_note', e.target.value)} className={inputCls} placeholder="24 months or 4000 hours" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1">
          <span>Source document</span>
          <input value={form.source_file} onChange={(e) => set('source_file', e.target.value)} className={inputCls} placeholder="File the price was read from" />
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1 flex-row items-center">
          <span>In use</span>
          <span className="flex items-center gap-2 pt-2">
            <input type="checkbox" checked={form.active !== false} onChange={(e) => set('active', e.target.checked)} />
            <span className="text-sm text-[var(--text-secondary)]">
              Retired quotations stay on file and stop pricing machines.
            </span>
          </span>
        </label>
        <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
          <span>Notes</span>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className={inputCls} />
        </label>
      </div>
      {invalid && (
        <p className="mt-3 text-xs text-amber-300">
          An asset class and an ex-VAT price are both required. Without them the quotation cannot price anything.
        </p>
      )}
    </Modal>
  )
}
