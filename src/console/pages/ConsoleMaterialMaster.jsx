/**
 * ConsoleMaterialMaster - review and override what every item code actually IS
 * (V367), now with one-click and bulk confirmation (V416).
 *
 * This is where a guess becomes a decision. Cost category is proposed from the
 * item description, which is unauditable and cannot be corrected for a single
 * item. Here a human confirms or changes it, and from then on the transaction's
 * category comes from that decision with a name and a timestamp attached.
 *
 * ~21,000 codes sit unreviewed, so reviewing them one modal at a time is not a
 * realistic path. Two fast paths were added:
 *   - EASY CONFIRM: a one-click Confirm on any row accepts its current proposed
 *     category. No modal.
 *   - MULTI CONFIRM: tick several rows (or all on the page) and confirm them
 *     together.
 * Confirming is money-safe by construction: it marks the item reviewed with the
 * category it ALREADY carries - the one already classifying its rows - so nothing
 * is re-bucketed. Historical money moves only through the separate
 * reclassify_from_master lever, which has its own preview and undo.
 *
 * The DESCRIPTION-AGREES signal is what makes bulk confirmation safe to use: when
 * an item's own description lands on the same cost bucket as its category, the two
 * agree and it can be confirmed with confidence; when they differ, look first.
 *
 * Super-admin only (the whole /console is gated). No raw SQL, no em/en dashes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes, RefreshCw, AlertTriangle, Loader2, Search, Check, Info, X, Download,
  ListFilter, CheckCheck, CheckCircle2, HelpCircle, Ban,
} from 'lucide-react'
import {
  listMaterials, deriveMaterials, setMaterial, setMaterialsBulk, materialCoverage,
  listMaterialTransactions,
} from '../../lib/api/materialMaster'
import {
  MATERIAL_CATEGORIES, MATERIAL_SUBCATEGORIES, costBucketFor,
  descriptionAgreement, transactionBucketSplit,
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
  const [confirmingId, setConfirmingId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [country, setCountry] = useState('KSA')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('all')      // all | unreviewed | reviewed | conflicting
  const [agree, setAgree] = useState('any')     // any | agree | differ
  const [selected, setSelected] = useState(() => new Set())

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
      setSelected(new Set())   // a fresh list invalidates any prior selection
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

  // Description agreement is derived from the row, so it filters client-side.
  const visible = useMemo(() => {
    if (agree === 'any') return rows
    return rows.filter((r) => descriptionAgreement(r) === agree)
  }, [rows, agree])

  const selectableIds = useMemo(
    () => visible.filter((r) => !r.reviewed).map((r) => r.id),
    [visible],
  )
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
  const selectedRows = useMemo(
    () => visible.filter((r) => selected.has(r.id)),
    [visible, selected],
  )

  function toggleRow(id) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function toggleAll() {
    setSelected((s) => {
      if (allSelected) return new Set()
      const n = new Set(s)
      selectableIds.forEach((id) => n.add(id))
      return n
    })
  }

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

  // EASY CONFIRM: one row, its current category, no modal.
  async function confirmOne(row) {
    setConfirmingId(row.id); setError(''); setNotice('')
    try {
      await setMaterial({
        country: row.country, item_code: row.item_code, category: row.category, reviewed: true,
      })
      // Update the row in place rather than reloading the whole list.
      setRows((rs) => rs.map((r) => (r.id === row.id
        ? { ...r, reviewed: true, conflicting: false } : r)))
      setSelected((s) => { const n = new Set(s); n.delete(row.id); return n })
    } catch (e) {
      setError(e?.message || 'Could not confirm that item.')
    } finally {
      setConfirmingId(null)
    }
  }

  // MULTI CONFIRM: the current selection, each as its own current category.
  async function confirmSelected() {
    if (selectedRows.length === 0) return
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await setMaterialsBulk(selectedRows.map((r) => ({
        country: r.country, item_code: r.item_code, category: r.category,
      })))
      const ids = new Set(selectedRows.map((r) => r.id))
      setRows((rs) => rs.map((r) => (ids.has(r.id)
        ? { ...r, reviewed: true, conflicting: false } : r)))
      setSelected(new Set())
      setNotice(`Confirmed ${fmtNum(res.confirmed)} item${res.confirmed === 1 ? '' : 's'} as shown.`
        + `${res.skipped ? ` ${fmtNum(res.skipped)} skipped.` : ''}`
        + ' Each keeps the category it already had, so no spend was re-bucketed.')
      // Coverage moved; refresh just the headline figure.
      materialCoverage().then(setCoverage).catch(() => {})
    } catch (e) {
      setError(e?.message || 'Could not confirm the selected items.')
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
      const changed = draft.category !== detail.category
      setRows((rs) => rs.map((r) => (r.id === detail.id
        ? { ...r, reviewed: true, conflicting: false, category: draft.category,
            subcategory: draft.subcategory || null, uom: draft.uom || null } : r)))
      setDetail(null)
      if (changed) materialCoverage().then(setCoverage).catch(() => {})
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
      description_agrees: descriptionAgreement(r),
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
  const unreviewedCount = useMemo(() => visible.filter((r) => !r.reviewed).length, [visible])

  return (
    <div className="space-y-5 pb-24">
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
          Confirming an item accepts the category it already has, so no spend is
          re-bucketed - it only records the decision with your name on it. The green
          tick means the item&apos;s own description agrees with that category, so it is
          safe to confirm quickly; an amber question mark means the two differ, so open
          it and look first.
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
        {/* Description-agreement filter: the fast lane for confident bulk confirm. */}
        <div className="flex gap-1.5">
          {[['any', 'Description any', null],
            ['agree', 'Agrees', CheckCircle2],
            ['differ', 'Differs', HelpCircle]].map(([k, label, Icon]) => (
            <button key={k} onClick={() => setAgree(k)}
              className={`px-2.5 py-1 rounded-lg text-[11px] border flex items-center gap-1 ${
                agree === k ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
              {Icon && <Icon size={10} />} {label}
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
      ) : visible.length === 0 ? (
        <div className="text-center text-sm text-gray-500 py-16 border border-gray-800 rounded-xl">
          {search ? 'No item matches that search.'
            : agree !== 'any' ? 'No item in this list matches that description filter.'
              : 'No items yet. Use "Refresh from transactions" to build the list from your expense data.'}
        </div>
      ) : (
        <>
          {unreviewedCount > 0 && (
            <p className="text-[11px] text-gray-500">
              {fmtNum(unreviewedCount)} of the {fmtNum(visible.length)} shown are still using the
              description as a guess.
              {selectableIds.length > 0 && (
                <button onClick={toggleAll} className="ml-2 text-orange-400 hover:text-orange-300 underline">
                  {allSelected ? 'Clear selection' : `Select all ${fmtNum(selectableIds.length)} unreviewed here`}
                </button>
              )}
            </p>
          )}
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full text-left">
                <thead className="bg-black/30 text-[10px] uppercase tracking-wide text-gray-500 sticky top-0">
                  <tr>
                    <th className="px-3 py-2.5 w-8">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}
                        disabled={selectableIds.length === 0}
                        className="accent-orange-500 disabled:opacity-30" title="Select all unreviewed on this page" />
                    </th>
                    <th className="px-2 py-2.5 font-semibold">Item</th>
                    <th className="px-3 py-2.5 font-semibold">Counted as</th>
                    <th className="px-3 py-2.5 font-semibold">Description</th>
                    <th className="px-3 py-2.5 font-semibold">Spend</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {visible.map((r) => {
                    const ag = descriptionAgreement(r)
                    const isSel = selected.has(r.id)
                    return (
                      <tr key={r.id} className={
                        isSel ? 'bg-orange-950/20'
                          : r.conflicting ? 'bg-amber-950/10' : 'hover:bg-black/20'}>
                        <td className="px-3 py-2.5">
                          {!r.reviewed && (
                            <input type="checkbox" checked={isSel} onChange={() => toggleRow(r.id)}
                              className="accent-orange-500" />
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <p className="text-xs text-gray-200 font-mono">{r.item_code}</p>
                          <p className="text-[10px] text-gray-500 truncate max-w-[240px]" title={r.item_name}>
                            {r.item_name || 'No description on record'}
                          </p>
                          {(r.brand || r.subcategory) && (
                            <p className="text-[9px] text-gray-600 mt-0.5">
                              {[r.brand, r.subcategory].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                            BUCKET_TONE[costBucketFor(r.category)]}`}>
                            {labelFor(r.category)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <AgreeBadge agreement={ag} />
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
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {!r.reviewed && (
                            <button onClick={() => confirmOne(r)} disabled={confirmingId === r.id || busy}
                              title="Confirm as its current category"
                              className="h-7 px-2 rounded-lg bg-emerald-700/40 border border-emerald-700/60 text-[11px] text-emerald-200 hover:bg-emerald-700/60 inline-flex items-center gap-1 disabled:opacity-50 mr-1.5">
                              {confirmingId === r.id
                                ? <Loader2 size={11} className="animate-spin" />
                                : <Check size={11} />} Confirm
                            </button>
                          )}
                          <button onClick={() => openDetail(r)}
                            className="h-7 px-2.5 rounded-lg bg-gray-800 border border-gray-700 text-[11px] text-gray-300 hover:text-white">
                            {r.reviewed ? 'Edit' : 'Review'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Multi-confirm action bar - appears only when something is selected. */}
      {selectedRows.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,640px)]
          rounded-xl bg-[#12121a] border border-orange-700/50 shadow-xl px-4 py-3
          flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCheck size={16} className="text-orange-400 flex-shrink-0" />
            <p className="text-xs text-gray-200">
              <span className="font-semibold">{fmtNum(selectedRows.length)}</span> selected.
              Confirm each as the category it already has.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setSelected(new Set())}
              className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white flex items-center gap-1.5">
              <Ban size={12} /> Clear
            </button>
            <button onClick={confirmSelected} disabled={busy}
              className="h-9 px-4 rounded-lg bg-orange-600 hover:bg-orange-500 text-xs font-semibold text-white flex items-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />}
              Confirm {fmtNum(selectedRows.length)}
            </button>
          </div>
        </div>
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
              {/* At-a-glance detail: how this code's money actually splits. */}
              <MoneySplit txns={detailTxns} country={detail.country} agreement={descriptionAgreement(detail)} />

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
                  How this code has been used ({fmtNum(detail.txn_rows)} lines,
                  {' '}{fmtNum(new Set(detailTxns.map((t) => (t.item_description || '').trim())).size)} distinct descriptions)
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

/** The description-agrees signal, the fast-confirm cue. */
function AgreeBadge({ agreement }) {
  if (agreement === 'agree') {
    return (
      <span className="text-[10px] text-emerald-300 flex items-center gap-1" title="The description agrees with this category">
        <CheckCircle2 size={11} /> Agrees
      </span>
    )
  }
  if (agreement === 'differ') {
    return (
      <span className="text-[10px] text-amber-300 flex items-center gap-1" title="The description would suggest a different category - look before confirming">
        <HelpCircle size={11} /> Differs
      </span>
    )
  }
  return <span className="text-[10px] text-gray-600" title="No description to compare">No description</span>
}

/** A one-line split of where this code's money is actually booked. */
function MoneySplit({ txns, country, agreement }) {
  const split = transactionBucketSplit(txns)
  const cur = CURRENCY[country] || ''
  const pct = (v) => (split.total > 0 ? Math.round((v / split.total) * 100) : 0)
  const parts = [
    ['tyre', 'Tyre', 'bg-emerald-500'],
    ['spare', 'Spare', 'bg-sky-500'],
    ['oil', 'Oil', 'bg-amber-500'],
  ].filter(([k]) => split[k] > 0)
  if (split.total <= 0) return null
  return (
    <div className="rounded-lg border border-gray-800 bg-black/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-gray-400">Where this code&apos;s money sits today</p>
        {agreement === 'agree' && (
          <span className="text-[10px] text-emerald-300 flex items-center gap-1">
            <CheckCircle2 size={11} /> description agrees
          </span>
        )}
        {agreement === 'differ' && (
          <span className="text-[10px] text-amber-300 flex items-center gap-1">
            <HelpCircle size={11} /> description differs
          </span>
        )}
      </div>
      <div className="h-2 rounded-full overflow-hidden flex bg-gray-800">
        {parts.map(([k, , colour]) => (
          <div key={k} className={colour} style={{ width: `${pct(split[k])}%` }} title={`${k} ${pct(split[k])}%`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {parts.map(([k, label]) => (
          <span key={k} className="text-[10px] text-gray-400">
            {label} {fmtMoney(split[k])} {cur} ({pct(split[k])}%)
          </span>
        ))}
      </div>
    </div>
  )
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
