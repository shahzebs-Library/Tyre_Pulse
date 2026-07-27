/**
 * What we changed about your file, and how to change it back.
 *
 * The ERP export files every line under its own Spare / Trye / Oil column. The
 * app does not trust that - the category is decided by the item itself, which is
 * why a real tyre the ERP filed under Spare ends up in tyre spend, and why the
 * gearbox sitting in the tyre column was findable at all. The rule is right and
 * it stays. What was missing is that nobody could SEE it: the totals simply
 * differed from the file with no way to ask where.
 *
 * Three groups, and the split is the file's own doing:
 *   Moved       the file said one bucket, we decided another
 *   Kept        we agreed with the file
 *   Not stated  the file left all three columns blank, so there was nothing to
 *               agree with and the decision is ours alone
 *
 * Overriding writes to the material master - the same single lever the Material
 * Master page uses - and then re-applies every reviewed decision to the
 * transactions already loaded. That last step previews first, because it is the
 * only path in the system that moves money that is already reported.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Shuffle, RefreshCw, AlertTriangle, Search, Check, Loader2, Info, Undo2, Download,
} from 'lucide-react'
import {
  getClassificationDecisions, applyReviewedDecisions, revertDecisionBatch,
} from '../../../lib/api/classificationDecisions'
import { setMaterial } from '../../../lib/api/materialMaster'
import {
  bucketLabel, reasonLabel, needsAttention, attentionReason, movementSentence,
  summariseCountries, OVERRIDE_CATEGORIES, overrideMovesMoney, decisionKey, MOVEMENTS,
} from '../../../lib/classificationDecisions'
import { exportToExcel, reportFileName } from '../../../lib/exportUtils'
import { toUserMessage } from '../../../lib/safeError'

const VIEWS = [
  { key: 'moved', label: 'Moved', hint: 'We put these somewhere other than your file did' },
  { key: 'kept', label: 'Kept', hint: 'We agreed with your file' },
  { key: 'unlabelled', label: 'Not stated', hint: 'Your file left the category blank' },
  { key: 'all', label: 'Everything', hint: 'Every item, however it was decided' },
]

const money = (v, ccy) => (Number.isFinite(Number(v))
  ? `${ccy || ''} ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim()
  : 'N/A')
const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString() : 'N/A')
const pct = (v) => (Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(1)}%` : 'N/A')

const BUCKET_TONE = {
  tyre: 'bg-sky-500/20 text-sky-200 border-sky-600/50',
  oil: 'bg-amber-500/20 text-amber-200 border-amber-600/50',
  spare: 'bg-gray-600/30 text-gray-300 border-gray-600',
  'not stated': 'bg-gray-800 text-gray-500 border-gray-700',
}
const Bucket = ({ b }) => (
  <span className={`px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap ${BUCKET_TONE[b] || BUCKET_TONE.spare}`}>
    {bucketLabel(b)}
  </span>
)

export default function DecisionsPanel({ country }) {
  const [view, setView] = useState('moved')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState('')       // decisionKey being saved
  const [pending, setPending] = useState({})     // decisionKey -> chosen category
  const [preview, setPreview] = useState(null)   // dry-run result awaiting confirmation
  const [applying, setApplying] = useState(false)
  const [lastBatch, setLastBatch] = useState(null)

  // Debounced search: this reads every expense row, so a query per keystroke
  // would be a scan per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setTerm(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setData(await getClassificationDecisions({ country, view, search: term, limit: 300 }))
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the decisions.'))
    } finally { setLoading(false) }
  }, [country, view, term])

  useEffect(() => { load() }, [load])

  const countries = useMemo(() => summariseCountries(data?.countries), [data])
  const items = data?.items || []
  const flagged = useMemo(() => items.filter(needsAttention).length, [items])

  async function saveOverride(row, category) {
    const key = decisionKey(row)
    setSaving(key); setError(''); setNotice('')
    try {
      await setMaterial({ country: row.country, item_code: row.item_code, category, reviewed: true })
      setPending((p) => ({ ...p, [key]: category }))
      setNotice(overrideMovesMoney(row, category)
        ? `Saved. ${row.item_code} is now a ${category.replace('_', ' ')}. Use "Apply to my data" to move the ${num(row.rows)} line(s) already loaded.`
        : `Saved. ${row.item_code} is now recorded as a ${category.replace('_', ' ')}. This does not change any total, because it stays in the same cost bucket.`)
    } catch (e) {
      setError(toUserMessage(e, 'Could not save that decision.'))
    } finally { setSaving('') }
  }

  async function runPreview() {
    setApplying(true); setError(''); setNotice('')
    try {
      setPreview(await applyReviewedDecisions(true))
    } catch (e) {
      setError(toUserMessage(e, 'Could not preview the change.'))
    } finally { setApplying(false) }
  }

  async function confirmApply() {
    setApplying(true); setError('')
    try {
      const res = await applyReviewedDecisions(false)
      setPreview(null)
      setLastBatch(res?.batch_id || null)
      setNotice(`${num(res?.rows_updated)} line(s) moved. You can undo this while you are on this page.`)
      setPending({})
      await load()
    } catch (e) {
      setError(toUserMessage(e, 'Could not apply the change.'))
    } finally { setApplying(false) }
  }

  async function undoLast() {
    setApplying(true); setError('')
    try {
      const res = await revertDecisionBatch(lastBatch)
      setLastBatch(null)
      setNotice(`Undone. ${num(res?.rows_reverted ?? res?.rows_updated)} line(s) put back.`)
      await load()
    } catch (e) {
      setError(toUserMessage(e, 'Could not undo that change.'))
    } finally { setApplying(false) }
  }

  function exportRows() {
    exportToExcel(
      items.map((r) => ({
        country: r.country, item_code: r.item_code, item_name: r.item_name,
        your_file_said: bucketLabel(r.erp_said), we_filed_it_as: bucketLabel(r.we_said),
        what_happened: movementSentence(r), why: reasonLabel(r.decided_by),
        confidence: r.confidence, lines: r.rows, value: r.value, currency: r.currency,
        reviewed: r.reviewed ? 'yes' : 'no',
        needs_a_look: needsAttention(r) ? attentionReason(r) : '',
      })),
      ['country', 'item_code', 'item_name', 'your_file_said', 'we_filed_it_as', 'what_happened',
        'why', 'confidence', 'lines', 'value', 'currency', 'reviewed', 'needs_a_look'],
      ['Country', 'Item code', 'Item', 'Your file said', 'We filed it as', 'What happened',
        'Why', 'Confidence', 'Lines', 'Value', 'Currency', 'Reviewed', 'Needs a look'],
      reportFileName('Classification decisions', VIEWS.find((v) => v.key === view)?.label || ''),
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-900/50 border border-gray-800 rounded-lg p-3">
        <Info size={14} className="text-orange-400 mt-0.5 shrink-0" />
        <p>
          Your file files every line under its own Spare, Tyre or Oil column. The system decides
          from the item itself, so the two can disagree. This is every disagreement, with the money
          attached, and you can change any of them.
        </p>
      </div>

      {/* Per country, never added together: each reports in its own currency. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {countries.map((c) => (
          <div key={c.country} className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
            <p className="text-sm font-semibold text-gray-200">{c.country}</p>
            <p className="text-[11px] text-gray-500 mb-2">{num(c.total_rows)} lines - {money(c.total_value, c.currency)}</p>
            <dl className="space-y-1 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-amber-300">Moved</dt>
                <dd className="text-gray-300">{num(c.moved_rows)} ({pct(c.moved_share)}) - {money(c.moved_value, c.currency)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-emerald-300">Kept</dt>
                <dd className="text-gray-300">{num(c.kept_rows)} - {money(c.kept_value, c.currency)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-400">Not stated</dt>
                <dd className="text-gray-300">{num(c.unlabelled_rows)} - {money(c.unlabelled_value, c.currency)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.key} onClick={() => setView(v.key)} title={v.hint}
            className={`px-3 py-1.5 rounded-lg text-xs border ${view === v.key
              ? 'bg-orange-500/20 border-orange-500/60 text-orange-200'
              : 'border-gray-800 text-gray-400 hover:bg-gray-800/60'}`}
          >
            {v.label}
          </button>
        ))}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Item code or description"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600"
          />
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 rounded-lg border border-gray-800 text-xs text-gray-400 hover:bg-gray-800/60 flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button onClick={exportRows} disabled={!items.length}
          className="px-3 py-1.5 rounded-lg border border-gray-800 text-xs text-gray-400 hover:bg-gray-800/60 flex items-center gap-1.5 disabled:opacity-50">
          <Download size={13} /> Excel
        </button>
      </div>

      {flagged > 0 && (
        <p className="text-xs text-amber-300 flex items-center gap-1.5">
          <AlertTriangle size={13} /> {flagged} of these were decided on weak evidence. They are marked below.
        </p>
      )}
      {notice && <p className="text-xs text-emerald-300">{notice}</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}

      {/* Applying is the only path that moves money already reported, so it
          previews first and stays undoable afterwards. */}
      <div className="flex flex-wrap items-center gap-2 bg-gray-900/50 border border-gray-800 rounded-lg p-3">
        <p className="text-xs text-gray-400 flex-1 min-w-[200px]">
          Your decisions apply to new uploads immediately. Lines already loaded only move when you apply them.
        </p>
        {lastBatch && (
          <button onClick={undoLast} disabled={applying}
            className="px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-1.5 disabled:opacity-50">
            <Undo2 size={13} /> Undo last apply
          </button>
        )}
        <button onClick={runPreview} disabled={applying}
          className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-medium flex items-center gap-1.5 disabled:opacity-50">
          {applying ? <Loader2 size={13} className="animate-spin" /> : <Shuffle size={13} />} Apply to my data
        </button>
      </div>

      {preview && (
        <div className="bg-gray-900 border border-orange-600/50 rounded-lg p-4 space-y-2">
          <p className="text-sm text-gray-200 font-semibold">
            {num(preview.rows_that_change)} line(s) would move
          </p>
          {(preview.moves || []).length === 0 ? (
            <p className="text-xs text-gray-500">
              Nothing would change. Every reviewed item is already in the bucket you chose.
            </p>
          ) : (
            <ul className="text-xs text-gray-400 space-y-1">
              {(preview.moves || []).map((m, i) => (
                <li key={i}>
                  {m.country}: {num(m.rows)} line(s) from {bucketLabel(m.from_bucket)} to {bucketLabel(m.to_bucket)}, {num(m.value)}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={confirmApply} disabled={applying || !preview.rows_that_change}
              className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-medium disabled:opacity-50">
              {applying ? 'Applying...' : 'Yes, move them'}
            </button>
            <button onClick={() => setPreview(null)} disabled={applying}
              className="px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-400 hover:bg-gray-800">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 py-8 text-center">Reading the decisions behind your data...</p>
      ) : !data || data.ok === false ? (
        <p className="text-xs text-gray-500 py-8 text-center">
          This view is not available on this database yet.
        </p>
      ) : !items.length ? (
        <p className="text-xs text-gray-500 py-8 text-center">
          {term ? 'No item matches that search in this view.'
            : view === MOVEMENTS.MOVED ? 'Nothing was moved. Every line is where your file put it.'
              : 'Nothing to show in this view.'}
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-800 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-900/80 text-gray-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Item</th>
                <th className="text-left px-3 py-2 font-medium">Your file said</th>
                <th className="text-left px-3 py-2 font-medium">We filed it as</th>
                <th className="text-left px-3 py-2 font-medium">Why</th>
                <th className="text-right px-3 py-2 font-medium">Lines</th>
                <th className="text-right px-3 py-2 font-medium">Value</th>
                <th className="text-left px-3 py-2 font-medium">Change it to</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const key = decisionKey(r)
                const flag = needsAttention(r)
                const chosen = pending[key] || r.reviewed_category || ''
                return (
                  <tr key={key} className="border-t border-gray-800/70 hover:bg-gray-900/40 align-top">
                    <td className="px-3 py-2">
                      <p className="text-gray-200 font-mono">{r.item_code}</p>
                      <p className="text-gray-500 max-w-[280px] truncate" title={r.item_name}>{r.item_name}</p>
                      <p className="text-[10px] text-gray-600">{r.country}</p>
                      {flag && (
                        <p className="text-[10px] text-amber-400 flex items-start gap-1 mt-0.5 max-w-[280px]">
                          <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {attentionReason(r)}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2"><Bucket b={r.erp_said} /></td>
                    <td className="px-3 py-2"><Bucket b={r.we_said} /></td>
                    <td className="px-3 py-2 text-gray-400">
                      {reasonLabel(r.decided_by)}
                      {r.reviewed && (
                        <span className="ml-1 text-emerald-400 inline-flex items-center gap-0.5">
                          <Check size={10} /> reviewed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300">{num(r.rows)}</td>
                    <td className="px-3 py-2 text-right text-gray-300 whitespace-nowrap">{money(r.value, r.currency)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={chosen}
                        disabled={saving === key}
                        onChange={(e) => e.target.value && saveOverride(r, e.target.value)}
                        className="px-2 py-1 rounded bg-gray-900 border border-gray-700 text-xs text-gray-200 disabled:opacity-50"
                      >
                        <option value="">Leave as it is</option>
                        {OVERRIDE_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                      {saving === key && <Loader2 size={12} className="inline ml-1.5 animate-spin text-gray-500" />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {items.length >= (data?.limit || 300) && (
        <p className="text-[11px] text-gray-500">
          Showing the {num(data.limit)} highest-value items. Search to reach the rest.
        </p>
      )}
    </div>
  )
}
