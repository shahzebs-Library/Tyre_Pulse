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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes, RefreshCw, Check, Info, Download,
  ListFilter, CheckCheck, CheckCircle2, HelpCircle, Ban, PieChart, BarChart3,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Code, Btn, Segmented, SearchInput,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { ShareChart, BarsChart, STATUS, useChartTheme } from '../components/ui/charts'
import {
  listMaterials, deriveMaterials, setMaterial, setMaterialsBulk, materialCoverage,
  listMaterialTransactions,
} from '../../lib/api/materialMaster'
import {
  MATERIAL_CATEGORIES, MATERIAL_SUBCATEGORIES, costBucketFor,
  descriptionAgreement, transactionBucketSplit,
} from '../../lib/materialMaster'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

const fmtNum = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A')
const fmtMoney = (n) => (Number.isFinite(Number(n))
  ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) : 'N/A')

const BUCKET_TONE = { tyre: 'good', oil: 'warning', spare: 'info' }

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
  const [detailLoading, setDetailLoading] = useState(false)
  const [draft, setDraft] = useState({})
  // Which item the transaction list belongs to, so a slow answer for the item
  // opened a moment ago cannot land under the one open now.
  const detailSeq = useRef(0)

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
      setError(toUserMessage(e, 'Could not load the material master.'))
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
      setError(toUserMessage(e, 'Could not refresh from transactions.'))
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
      setError(toUserMessage(e, 'Could not confirm that item.'))
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
      setError(toUserMessage(e, 'Could not confirm the selected items.'))
    } finally {
      setBusy(false)
    }
  }

  async function openDetail(row) {
    const seq = ++detailSeq.current
    setDetail(row)
    setDraft({ category: row.category, subcategory: row.subcategory || '', uom: row.uom || '', notes: row.notes || '' })
    setDetailTxns([])
    // An item with no transactions used to read "Loading the transactions" for
    // ever, because an empty answer looked the same as no answer yet.
    setDetailLoading(true)
    try {
      const txns = await listMaterialTransactions(row.country, row.item_code, 40)
      if (seq === detailSeq.current) setDetailTxns(txns)
    } finally {
      if (seq === detailSeq.current) setDetailLoading(false)
    }
  }

  function closeDetail() {
    if (busy) return
    detailSeq.current += 1
    setDetail(null)
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
      setError(toUserMessage(e, 'Could not save that item.'))
    } finally {
      setBusy(false)
    }
  }

  async function download() {
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
    try {
      await exportToExcel(out, keys, keys.map((k) => k.replace(/_/g, ' ')),
        reportFileName('TyrePulse Material Master', country))
    } catch (e) {
      setError(toUserMessage(e, 'Could not export the list.'))
    }
  }

  const reviewedShare = coverage?.reviewed_value_share
  const unreviewedCount = useMemo(() => visible.filter((r) => !r.reviewed).length, [visible])

  return (
    <div className="space-y-5 max-w-7xl pb-24">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><Boxes size={18} className="text-orange-400" /> Material Master</h1>
          <p className="text-xs text-gray-500 mt-1">
            Decide what each item actually is. Your decision overrides whatever the
            description says, so a spare part can never be counted as a tyre.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {rows.length > 0 && <Btn icon={Download} onClick={download}>Excel</Btn>}
          <Btn icon={RefreshCw} onClick={refresh} busy={busy}>Refresh from transactions</Btn>
        </div>
      </header>

      {/* Coverage: money reviewed, not rows reviewed. Whole scope, every country. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Item codes" value={fmtNum(coverage?.codes_total)} icon={Boxes} sub="All countries in your scope" />
        <StatTile label="Reviewed by a person" value={fmtNum(coverage?.codes_reviewed)} tone="good" icon={CheckCircle2} />
        <StatTile label="Need a decision" value={fmtNum(coverage?.codes_conflicting)} icon={ListFilter}
          tone={Number(coverage?.codes_conflicting) > 0 ? 'warning' : 'default'} />
        <StatTile label="Share of spend reviewed"
          value={reviewedShare == null ? 'N/A' : `${reviewedShare}%`}
          sub="A share, so it does not add currencies"
          tone={reviewedShare != null && reviewedShare > 0 ? 'good' : 'default'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader icon={PieChart} title="Review coverage"
            subtitle="Item codes a person has confirmed, against those still classified from the description. Counts, across every country in your scope." />
          <CoverageShare coverage={coverage} />
        </Panel>
        <Panel>
          <PanelHeader icon={BarChart3} title={`Spend by category, ${country}`}
            subtitle={`The ${fmtNum(rows.length)} highest-spend items loaded for ${country}, in ${CURRENCY[country] || 'local currency'}. One country at a time, so currencies are never added together.`} />
          <CategoryBars rows={rows} country={country} />
        </Panel>
      </div>

      <Note icon={Info} tone="accent">
        Confirming an item accepts the category it already has, so no spend is
        re-bucketed. It only records the decision with your name on it. The green
        tick means the item&apos;s own description agrees with that category, so it is
        safe to confirm quickly; an amber question mark means the two differ, so open
        it and look first.
      </Note>

      <ErrorState message={error} onRetry={load} />
      {notice && <Note icon={Check} tone="accent"><span role="status">{notice}</span></Note>}

      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={country} onChange={setCountry}
            options={COUNTRIES.map((c) => ({ key: c, label: c }))} />
          <Segmented value={view} onChange={setView} options={[
            { key: 'all', label: 'All' },
            { key: 'unreviewed', label: 'Not reviewed' },
            { key: 'reviewed', label: 'Reviewed' },
            { key: 'conflicting', label: <span className="inline-flex items-center gap-1"><ListFilter size={10} /> Needs a decision</span> },
          ]} />
          <Segmented value={agree} onChange={setAgree} options={[
            { key: 'any', label: 'Description any' },
            { key: 'agree', label: <span className="inline-flex items-center gap-1"><CheckCircle2 size={10} /> Agrees</span> },
            { key: 'differ', label: <span className="inline-flex items-center gap-1"><HelpCircle size={10} /> Differs</span> },
          ]} />
          <SearchInput value={search} onChange={setSearch} placeholder="Search item code or name" className="flex-1 min-w-[200px]" />
        </div>
      </Panel>

      {loading ? (
        <LoadingState label="Loading the material master" />
      ) : visible.length === 0 ? (
        <Panel>
          <EmptyState icon={Boxes}
            title={search ? 'No item matches that search.'
              : agree !== 'any' ? 'No item in this list matches that description filter.'
                : 'No items to show.'}
            reason={search || agree !== 'any'
              ? 'Clear the search or the description filter to widen the list.'
              : 'Either the list has not been built yet or it could not be read. Use Refresh from transactions to build it from your expense data.'} />
        </Panel>
      ) : (
        <>
          {unreviewedCount > 0 && (
            <p className="text-[11px] text-gray-500 flex flex-wrap items-center gap-2">
              {fmtNum(unreviewedCount)} of the {fmtNum(visible.length)} shown are still using the
              description as a guess.
              {selectableIds.length > 0 && (
                <Btn size="xs" variant="quiet" icon={CheckCheck} onClick={toggleAll}>
                  {allSelected ? 'Clear selection' : `Select all ${fmtNum(selectableIds.length)} unreviewed here`}
                </Btn>
              )}
            </p>
          )}
          <div className="max-h-[560px] overflow-auto">
            <Table>
              <THead>
                <Th className="w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    disabled={selectableIds.length === 0} aria-label="Select all unreviewed on this page"
                    className="accent-orange-500 disabled:opacity-30" title="Select all unreviewed on this page" />
                </Th>
                <Th>Item</Th>
                <Th>Counted as</Th>
                <Th>Description</Th>
                <Th align="right">Spend</Th>
                <Th>Status</Th>
                <Th align="right">Action</Th>
              </THead>
              <tbody>
                {visible.map((r) => {
                  const ag = descriptionAgreement(r)
                  const isSel = selected.has(r.id)
                  return (
                    <Tr key={r.id} tone={!isSel && r.conflicting ? 'warning' : undefined}
                      className={isSel ? 'bg-orange-950/20' : ''}>
                      <Td>
                        {!r.reviewed && (
                          <input type="checkbox" checked={isSel} onChange={() => toggleRow(r.id)}
                            aria-label={`Select ${r.item_code}`} className="accent-orange-500" />
                        )}
                      </Td>
                      <Td>
                        <Code>{r.item_code}</Code>
                        <p className="text-[10px] text-gray-500 truncate max-w-[240px] mt-1" title={r.item_name}>
                          {r.item_name || 'No description on record'}
                        </p>
                        {(r.brand || r.subcategory) && (
                          <p className="text-[9px] text-gray-600 mt-0.5">
                            {[r.brand, r.subcategory].filter(Boolean).join(' | ')}
                          </p>
                        )}
                      </Td>
                      <Td><Badge tone={BUCKET_TONE[costBucketFor(r.category)] || 'default'}>{labelFor(r.category)}</Badge></Td>
                      <Td><AgreeBadge agreement={ag} /></Td>
                      <Td align="right" nowrap>
                        <p className="text-[11px] text-gray-300 tabular-nums">
                          {fmtMoney(r.txn_value)} {CURRENCY[r.country] || ''}
                        </p>
                        <p className="text-[10px] text-gray-600">{fmtNum(r.txn_rows)} lines</p>
                      </Td>
                      <Td>
                        {r.reviewed ? <Badge tone="good" icon={Check}>Confirmed</Badge>
                          : r.conflicting ? <Badge tone="warning">Needs a decision</Badge>
                            : <Badge tone="quiet">From description</Badge>}
                      </Td>
                      <Td align="right" nowrap>
                        <span className="inline-flex gap-1.5">
                          {!r.reviewed && (
                            <Btn size="xs" variant="good" icon={Check} onClick={() => confirmOne(r)}
                              busy={confirmingId === r.id} disabled={busy}
                              title="Confirm as its current category">Confirm</Btn>
                          )}
                          <Btn size="xs" onClick={() => openDetail(r)}>{r.reviewed ? 'Edit' : 'Review'}</Btn>
                        </span>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}

      {/* Multi-confirm action bar, shown only when something is selected. */}
      {selectedRows.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,640px)]">
          <div className="rounded-xl bg-gray-950 border border-orange-800/60 shadow-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCheck size={16} className="text-orange-400 flex-shrink-0" />
              <p className="text-xs text-gray-200">
                <span className="font-semibold">{fmtNum(selectedRows.length)}</span> selected.
                Confirm each as the category it already has.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Btn icon={Ban} onClick={() => setSelected(new Set())} disabled={busy}>Clear</Btn>
              <Btn variant="primary" icon={CheckCheck} onClick={confirmSelected} busy={busy}>
                Confirm {fmtNum(selectedRows.length)}
              </Btn>
            </div>
          </div>
        </div>
      )}

      <Modal open={!!detail} onClose={closeDetail} width="max-w-2xl"
        title={detail ? <span className="font-mono">{detail.item_code}</span> : ''}
        subtitle={detail ? `${detail.item_name || 'No description on record'} | ${detail.country}` : undefined}
        footer={(
          <>
            <span className="mr-auto self-center text-[11px] text-gray-500">Saving records your name against this decision.</span>
            <Btn onClick={closeDetail} disabled={busy}>Cancel</Btn>
            <Btn variant="primary" icon={Check} onClick={save} busy={busy} disabled={!draft.category}>Confirm</Btn>
          </>
        )}>
        {detail && (
          <div className="space-y-4">
            <MoneySplit txns={detailTxns} country={detail.country} agreement={descriptionAgreement(detail)} />

            <div>
              <p className="text-[11px] font-semibold text-gray-400 mb-1.5">What is this item?</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {MATERIAL_CATEGORIES.filter((c) => c.key !== 'unclassified').map((c) => {
                  const on = draft.category === c.key
                  return (
                    <button key={c.key} aria-pressed={on}
                      onClick={() => setDraft((d) => ({ ...d, category: c.key, subcategory: '' }))}
                      className={`px-2 py-1.5 rounded-lg text-[11px] border text-left transition-colors ${
                        on ? 'bg-orange-500/20 border-orange-600/60 text-orange-200'
                          : 'bg-gray-900 border-gray-800 text-gray-300 hover:bg-gray-800/60'}`}>
                      {c.label}
                      <span className="block text-[9px] opacity-70">counts as {c.costBucket}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {(MATERIAL_SUBCATEGORIES[draft.category] || []).length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-gray-400 mb-1.5">More detail (optional)</p>
                <div className="flex flex-wrap gap-1.5">
                  {MATERIAL_SUBCATEGORIES[draft.category].map((s) => (
                    <button key={s} aria-pressed={draft.subcategory === s}
                      onClick={() => setDraft((d) => ({ ...d, subcategory: d.subcategory === s ? '' : s }))}
                      className={`px-2 py-1 rounded-lg text-[10px] border transition-colors ${
                        draft.subcategory === s ? 'bg-orange-500/20 border-orange-600/60 text-orange-200'
                          : 'bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-800/60'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-semibold text-gray-400 mb-1.5">Unit</span>
                <input value={draft.uom} onChange={(e) => setDraft((d) => ({ ...d, uom: e.target.value }))}
                  placeholder="litre, piece, set"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-gray-400 mb-1.5">Note</span>
                <input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  placeholder="Why this classification"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none" />
              </label>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-gray-400 mb-1.5">
                How this code has been used ({fmtNum(detail.txn_rows)} lines,
                {' '}{fmtNum(new Set(detailTxns.map((t) => (t.item_description || '').trim())).size)} distinct descriptions)
              </p>
              {detailLoading ? (
                <LoadingState label="Loading the transactions" rows={2} />
              ) : detailTxns.length === 0 ? (
                <p className="text-[11px] text-gray-600">No transactions could be found for this code.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  <Table>
                    <THead><Th>Description</Th><Th>Site</Th><Th>Date</Th><Th align="right">Amount</Th></THead>
                    <tbody>
                      {detailTxns.map((t, i) => (
                        <Tr key={i}>
                          <Td><span className="block max-w-[220px] truncate text-gray-400" title={t.item_description}>{t.item_description || 'No description'}</span></Td>
                          <Td nowrap><span className="text-gray-500">{t.site || 'N/A'}</span></Td>
                          <Td nowrap><span className="text-gray-500">{t.event_date || 'N/A'}</span></Td>
                          <Td align="right" nowrap><span className="tabular-nums text-gray-300">{fmtMoney(t.line_cost)} {t.currency || ''}</span></Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </div>

            <ErrorState message={error} />
          </div>
        )}
      </Modal>
    </div>
  )
}

function labelFor(key) {
  return MATERIAL_CATEGORIES.find((c) => c.key === key)?.label || key || 'Unclassified'
}

/** The description-agrees signal, the fast-confirm cue. */
function AgreeBadge({ agreement }) {
  if (agreement === 'agree') {
    return <Badge tone="good" icon={CheckCircle2} title="The description agrees with this category">Agrees</Badge>
  }
  if (agreement === 'differ') {
    return <Badge tone="warning" icon={HelpCircle} title="The description would suggest a different category. Look before confirming.">Differs</Badge>
  }
  return <Badge tone="quiet" title="No description to compare">No description</Badge>
}

/** Codes reviewed by a person against codes still classified from text. */
function CoverageShare({ coverage }) {
  const theme = useChartTheme()
  const total = Number(coverage?.codes_total)
  const reviewed = Number(coverage?.codes_reviewed)
  if (!Number.isFinite(total) || !Number.isFinite(reviewed) || total <= 0) {
    return <EmptyState icon={PieChart} title="Coverage is not available." reason="The coverage figure could not be read, or no item codes exist yet." />
  }
  const conflicting = Math.min(Math.max(Number(coverage?.codes_conflicting) || 0, 0), Math.max(total - reviewed, 0))
  const parts = [
    { label: 'Reviewed', value: reviewed, color: STATUS[theme].good },
    { label: 'Needs a decision', value: conflicting, color: STATUS[theme].medium },
    { label: 'From description', value: Math.max(total - reviewed - conflicting, 0), color: STATUS[theme].low },
  ]
  const pct = Math.round((reviewed / total) * 100)
  return (
    <ShareChart parts={parts} height={160} center={{ value: `${pct}%`, label: 'reviewed' }}
      summary={`${reviewed} of ${total} item codes reviewed, ${conflicting} need a decision`} />
  )
}

/** Spend of the loaded items by category, for one country (one currency). */
function CategoryBars({ rows, country }) {
  const bars = useMemo(() => {
    const by = new Map()
    for (const r of rows) {
      if (r.country && r.country !== country) continue
      const k = labelFor(r.category)
      by.set(k, (by.get(k) || 0) + (Number(r.txn_value) || 0))
    }
    return [...by.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [rows, country])
  const cur = CURRENCY[country] || ''
  return (
    <BarsChart bars={bars} valueFormat={(v) => `${fmtMoney(v)} ${cur}`}
      summary={bars.map((b) => `${b.label}: ${Math.round(b.value)} ${cur}`).join(', ')}
      emptyText="No spend on the items loaded for this country." />
  )
}

/** A one-line split of where this code's money is actually booked. */
function MoneySplit({ txns, country, agreement }) {
  const split = transactionBucketSplit(txns)
  const cur = CURRENCY[country] || ''
  const pct = (v) => (split.total > 0 ? Math.round((v / split.total) * 100) : 0)
  if (split.total <= 0) return null
  const segs = [
    { key: 'tyre', label: 'Tyre', tone: 'good' },
    { key: 'spare', label: 'Spare', tone: 'muted' },
    { key: 'oil', label: 'Oil', tone: 'warning' },
  ].filter((p) => split[p.key] > 0)
  return (
    <Panel>
      <PanelHeader title="Where this code's money sits today"
        subtitle="From the transaction lines shown below."
        actions={agreement === 'agree'
          ? <Badge tone="good" icon={CheckCircle2}>Description agrees</Badge>
          : agreement === 'differ' ? <Badge tone="warning" icon={HelpCircle}>Description differs</Badge> : null} />
      <ProportionBarRow segs={segs} split={split} />
      <div className="flex flex-wrap gap-3 mt-2">
        {segs.map((p) => (
          <span key={p.key} className="text-[10px] text-gray-400">
            {p.label} {fmtMoney(split[p.key])} {cur} ({pct(split[p.key])}%)
          </span>
        ))}
      </div>
    </Panel>
  )
}

function ProportionBarRow({ segs, split }) {
  return <ProportionBar total={split.total} segments={segs.map((p) => ({ label: p.label, value: split[p.key], tone: p.tone }))} />
}
