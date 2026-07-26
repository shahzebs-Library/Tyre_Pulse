/**
 * ConsoleMaterialMaster - review and override what every item code actually IS (V367).
 *
 * This is where a guess becomes a decision. Cost category is proposed from the item
 * description, which is unauditable and cannot be corrected for a single item. Here a
 * human confirms or changes it, and from then on the transaction's category comes from
 * that decision with a name and a timestamp attached.
 *
 * Two deliberate choices in the UI:
 *
 *   1. Sorted by VALUE, not alphabetically. Reviewing the top 200 codes by money covers
 *      far more of the spend than 200 codes starting with A, and the coverage figure
 *      shown is the share of MONEY reviewed rather than the share of rows, for the same
 *      reason.
 *   2. Country is always visible and always part of the key. Item codes are NOT unique
 *      across countries in this data (450115-O is "COMPRESSOR OIL 68" in KSA and
 *      "GREASE MISC ITEMS" in UAE), so a decision belongs to one country's code.
 *
 * Super-admin only (the whole /console is gated). No raw SQL, no em/en dashes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes, RefreshCw, AlertTriangle, Loader2, Search, Check, Info, X, Download, ListFilter,
} from 'lucide-react'
import {
  listMaterials, deriveMaterials, setMaterial, materialCoverage, listMaterialTransactions,
} from '../../lib/api/materialMaster'
import {
  MATERIAL_CATEGORIES, MATERIAL_SUBCATEGORIES, costBucketFor,
} from '../../lib/materialMaster'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'

const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

const fmtNum = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A')
const fmtMoney = (n) => (Number.isFinite(Number(n))
  ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) : 'N/A')

const BUCKET_TONE = {
  tyre: 'text-emerald-300 border-emerald-800/50 bg-emerald-900/20',
  oil: 'text-amber-300 border-amber-800/50 bg-amber-900/20',
  spare: 'text-sky-300 border-sky-800/50 bg-sky-900/20',
}

export default function ConsoleMaterialMaster() {
  const [rows, setRows] = useState([])
  const [coverage, setCoverage] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [country, setCountry] = useState('KSA')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('all')   // all | unreviewed | reviewed | conflicting

  const [detail, setDetail] = useState(null)      // the item being reviewed
  const [detailTxns, setDetailTxns] = useState([])
  const [draft, setDraft] = useState({})

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [list, cov] = await Promise.all([
        listMaterials({
          country,
          search,
          unreviewedOnly: view === 'unreviewed',
          reviewedOnly: view === 'reviewed',
          conflictingOnly: view === 'conflicting',
          limit: 300,
        }),
        materialCoverage(),
      ])
      setRows(list); setCoverage(cov)
    } catch (e) {
      setError(e?.message || 'Could not load the material master.')
    } finally {
      setLoading(false)
    }
  }, [country, search, view])

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0)   // debounce typing, not filter clicks
    return () => clearTimeout(t)
  }, [load, search])

  async function refresh() {
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await deriveMaterials()
      setNotice(`Refreshed from transactions: ${fmtNum(r.inserted)} new, ${fmtNum(r.updated)} updated`
        + `${r.conflicting ? `, ${fmtNum(r.conflicting)} need a decision` : ''}.`
        + ' Items you already reviewed were left untouched.')
      await load()
    } catch (e) {
      setError(e?.message || 'Could not refresh from transactions.')
    } finally {
      setBusy(false)
    }
  }

  async function openDetail(row) {
    setDetail(row)
    setDraft({ category: row.category, subcategory: row.subcategory || '', uom: row.uom || '', notes: row.notes || '' })
    setDetailTxns([])
    setDetailTxns(await listMaterialTransactions(row.country, row.item_code, 40))
  }

  async function save() {
    if (!detail) return
    setBusy(true); setError('')
    try {
      await setMaterial({
        country: detail.country,
        item_code: detail.item_code,
        category: draft.category,
        subcategory: draft.subcategory || null,
        uom: draft.uom || null,
        notes: draft.notes || null,
        reviewed: true,
      })
      setNotice(`${detail.item_code} confirmed as ${labelFor(draft.category)}. `
        + 'Every transaction with this code now uses that decision.')
      setDetail(null)
      await load()
    } catch (e) {
      setError(e?.message || 'Could not save that item.')
    } finally {
      setBusy(false)
    }
  }

  function download() {
    if (!rows.length) return
    const out = rows.map((r) => ({
      country: r.country,
      item_code: r.item_code,
      item_name: r.item_name || '',
      category: labelFor(r.category),
      cost_bucket: costBucketFor(r.category),
      subcategory: r.subcategory || '',
      brand: r.brand || '',
      uom: r.uom || '',
      reviewed: r.reviewed ? 'Yes' : 'No',
      needs_decision: r.conflicting ? 'Yes' : 'No',
      transactions: r.txn_rows,
      value: r.txn_value,
    }))
    const keys = Object.keys(out[0])
    exportToExcel(out, keys, keys.map((k) => k.replace(/_/g, ' ')),
      reportFileName('TyrePulse Material Master', country))
  }

  const reviewedShare = coverage?.reviewed_value_share
  const unreviewedCount = useMemo(() => rows.filter((r) => !r.reviewed).length, [rows])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <Boxes size={18} className="text-orange-400" /> Material Master
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Decide what each item actually is. Your decision overrides whatever the
            description says, so a spare part can never be counted as a tyre.
          </p>
        </div>
        <div className="flex gap-2">
          {rows.length > 0 && (
            <button onClick={download}
              className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white flex items-center gap-2">
              <Download size={13} /> Excel
            </button>
          )}
          <button onClick={refresh} disabled={busy}
            className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white flex items-center gap-2 disabled:opacity-50">
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh from transactions
          </button>
        </div>
      </div>

      {/* Coverage: money reviewed, not rows reviewed. */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Item codes" value={fmtNum(coverage?.codes_total)} />
        <Stat label="Reviewed by a person" value={fmtNum(coverage?.codes_reviewed)} />
        <Stat label="Need a decision" value={fmtNum(coverage?.codes_conflicting)}
          tone={Number(coverage?.codes_conflicting) > 0 ? 'amber' : 'plain'} />
        <Stat label="Share of spend reviewed"
          value={reviewedShare == null ? 'N/A' : `${reviewedShare}%`}
          tone={reviewedShare != null && reviewedShare > 0 ? 'emerald' : 'plain'} />
      </div>

      <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-sky-950/30 border border-sky-800/40">
        <Info size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-200">
          Items are listed by value, so reviewing the top of this list covers the most
          spend for the least effort. The same item code can mean different things in
          different countries, so each country keeps its own decision.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-950/40 border border-red-800/50">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40">
          <Check size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-200">{notice}</p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {COUNTRIES.map((c) => (
            <button key={c} onClick={() => setCountry(c)}
              className={`px-2.5 py-1 rounded-lg text-[11px] border ${
                country === c ? 'bg-orange-600 border-orange-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {[['all', 'All'], ['unreviewed', 'Not reviewed'], ['reviewed', 'Reviewed'],
            ['conflicting', 'Needs a decision']].map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-2.5 py-1 rounded-lg text-[11px] border flex items-center gap-1 ${
                view === k ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
              {k === 'conflicting' && <ListFilter size={10} />} {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item code or name"
            className="w-full h-9 bg-gray-800/80 border border-gray-700 rounded-lg pl-8 pr-3 text-xs text-white focus:outline-none focus:border-orange-500" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-7 h-7 text-orange-500 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center text-sm text-gray-500 py-16 border border-gray-800 rounded-xl">
          {search ? 'No item matches that search.'
            : 'No items yet. Use "Refresh from transactions" to build the list from your expense data.'}
        </div>
      ) : (
        <>
          {unreviewedCount > 0 && view === 'all' && (
            <p className="text-[11px] text-gray-500">
              {fmtNum(unreviewedCount)} of the {fmtNum(rows.length)} shown are still using the
              description as a guess.
            </p>
          )}
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full text-left">
                <thead className="bg-black/30 text-[10px] uppercase tracking-wide text-gray-500 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Item</th>
                    <th className="px-3 py-2.5 font-semibold">Counted as</th>
                    <th className="px-3 py-2.5 font-semibold">Spend</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {rows.map((r) => (
                    <tr key={r.id} className={r.conflicting ? 'bg-amber-950/10' : 'hover:bg-black/20'}>
                      <td className="px-4 py-2.5">
                        <p className="text-xs text-gray-200 font-mono">{r.item_code}</p>
                        <p className="text-[10px] text-gray-500 truncate max-w-[280px]" title={r.item_name}>
                          {r.item_name || 'No description on record'}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                          BUCKET_TONE[costBucketFor(r.category)]}`}>
                          {labelFor(r.category)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-[11px] text-gray-300">
                          {fmtMoney(r.txn_value)} {CURRENCY[r.country] || ''}
                        </p>
                        <p className="text-[10px] text-gray-600">{fmtNum(r.txn_rows)} lines</p>
                      </td>
                      <td className="px-3 py-2.5">
                        {r.reviewed ? (
                          <span className="text-[10px] text-emerald-300 flex items-center gap-1">
                            <Check size={10} /> Confirmed
                          </span>
                        ) : r.conflicting ? (
                          <span className="text-[10px] text-amber-300">Needs a decision</span>
                        ) : (
                          <span className="text-[10px] text-gray-600">From description</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button onClick={() => openDetail(r)}
                          className="h-7 px-2.5 rounded-lg bg-gray-800 border border-gray-700 text-[11px] text-gray-300 hover:text-white">
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Review one item */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setDetail(null)}>
          <div className="w-full max-w-2xl rounded-xl bg-[#0f0f16] border border-gray-800 flex flex-col max-h-[88vh]"
            onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-800 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white font-mono">{detail.item_code}</h3>
                <p className="text-[11px] text-gray-500 truncate">
                  {detail.item_name || 'No description on record'} · {detail.country}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-3 overflow-y-auto space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">
                  What is this item?
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {MATERIAL_CATEGORIES.filter((c) => c.key !== 'unclassified').map((c) => {
                    const on = draft.category === c.key
                    return (
                      <button key={c.key}
                        onClick={() => setDraft((d) => ({ ...d, category: c.key, subcategory: '' }))}
                        className={`px-2 py-1.5 rounded-lg text-[11px] border text-left ${
                          on ? 'bg-orange-600 border-orange-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'}`}>
                        {c.label}
                        <span className="block text-[9px] opacity-70">
                          counts as {c.costBucket}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {(MATERIAL_SUBCATEGORIES[draft.category] || []).length > 0 && (
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">
                    More detail (optional)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {MATERIAL_SUBCATEGORIES[draft.category].map((s) => (
                      <button key={s}
                        onClick={() => setDraft((d) => ({ ...d, subcategory: d.subcategory === s ? '' : s }))}
                        className={`px-2 py-1 rounded-lg text-[10px] border ${
                          draft.subcategory === s ? 'bg-gray-700 border-gray-600 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Unit</label>
                  <input value={draft.uom} onChange={(e) => setDraft((d) => ({ ...d, uom: e.target.value }))}
                    placeholder="litre, piece, set"
                    className="w-full h-8 bg-gray-800/80 border border-gray-700 rounded-lg px-2.5 text-xs text-white focus:outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Note</label>
                  <input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                    placeholder="Why this classification"
                    className="w-full h-8 bg-gray-800/80 border border-gray-700 rounded-lg px-2.5 text-xs text-white focus:outline-none focus:border-orange-500" />
                </div>
              </div>

              {/* The evidence: what this code was actually used for. */}
              <div>
                <p className="text-[11px] font-semibold text-gray-400 mb-1.5">
                  How this code has been used ({fmtNum(detail.txn_rows)} lines)
                </p>
                {detailTxns.length === 0 ? (
                  <p className="text-[11px] text-gray-600">Loading the transactions.</p>
                ) : (
                  <div className="rounded-lg border border-gray-800 max-h-44 overflow-y-auto divide-y divide-gray-800/60">
                    {detailTxns.map((t, i) => (
                      <div key={i} className="px-3 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-gray-400 truncate flex-1" title={t.item_description}>
                          {t.item_description || 'No description'}
                        </span>
                        <span className="text-[10px] text-gray-500 flex-shrink-0">
                          {t.site || ''} {t.event_date || ''}
                        </span>
                        <span className="text-[10px] text-gray-300 flex-shrink-0">
                          {fmtMoney(t.line_cost)} {t.currency || ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-500">
                Saving records your name against this decision.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setDetail(null)}
                  className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white">
                  Cancel
                </button>
                <button onClick={save} disabled={busy || !draft.category}
                  className="h-9 px-3 rounded-lg bg-orange-600 hover:bg-orange-500 text-xs font-semibold text-white flex items-center gap-2 disabled:opacity-40">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function labelFor(key) {
  return MATERIAL_CATEGORIES.find((c) => c.key === key)?.label || key || 'Unclassified'
}

function Stat({ label, value, tone }) {
  const tones = {
    amber: 'text-amber-300 border-amber-800/40 bg-amber-950/20',
    emerald: 'text-emerald-300 border-emerald-800/40 bg-emerald-950/20',
    plain: 'text-gray-200 border-gray-800 bg-black/20',
  }
  return (
    <div className={`px-3 py-2 rounded-xl border ${tones[tone] || tones.plain}`}>
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className="text-xl font-semibold leading-tight">{value}</p>
    </div>
  )
}
