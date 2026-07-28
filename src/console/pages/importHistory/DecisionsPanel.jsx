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
 *
 * THE INTERACTION THAT MATTERS: a change is STAGED, not fired on select. The
 * first build saved the moment the dropdown moved, so a mis-click silently
 * rewrote a category and there was no list of what you had touched. Now choices
 * collect in a tray you can review, undo individually, and save together.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Shuffle, RefreshCw, AlertTriangle, Check, Undo2, Download, Info, ArrowRight,
  ListChecks, Inbox, ChevronRight, Layers, Trash2, Sparkles,
} from 'lucide-react'
import {
  getClassificationDecisions, applyReviewedDecisions, revertDecisionBatch,
} from '../../../lib/api/classificationDecisions'
import { setMaterial, listMaterialTransactions } from '../../../lib/api/materialMaster'
import {
  bucketLabel, reasonLabel, needsAttention, attentionReason, movementSentence,
  summariseCountries, OVERRIDE_CATEGORIES, overrideMovesMoney, decisionKey,
  sortDecisions, SORTS,
} from '../../../lib/classificationDecisions'
import { exportToExcel, reportFileName } from '../../../lib/exportUtils'
import { toUserMessage } from '../../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, ProportionBar, Badge, Code, Btn, Segmented,
  SearchInput, Select, Toolbar, Table, THead, Th, Tr, Td, LoadingState, EmptyState,
  ErrorState, Modal,
} from '../../components/ui'

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

const BUCKET_TONE = { tyre: 'info', oil: 'warning', spare: 'default', 'not stated': 'quiet' }
const Bucket = ({ b }) => <Badge tone={BUCKET_TONE[b] || 'default'}>{bucketLabel(b)}</Badge>

/** The real transaction lines behind one item, so a decision is made on evidence. */
function LineEvidence({ country, itemCode }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    listMaterialTransactions(country, itemCode, 8)
      .then((r) => { if (live) setRows(r) })
      .catch((e) => { if (live) setErr(toUserMessage(e, 'Could not read the lines.')) })
    return () => { live = false }
  }, [country, itemCode])

  if (err) return <p className="text-[11px] text-red-300">{err}</p>
  if (!rows) return <p className="text-[11px] text-gray-600">Reading the lines behind this item...</p>
  if (!rows.length) return <p className="text-[11px] text-gray-600">No individual lines could be read for this item.</p>
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-gray-600">
        Lines behind this item {rows.length >= 8 ? '(highest value first, first 8)' : ''}
      </p>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
          <span className="text-gray-300 flex-1 min-w-[200px]">{r.item_description || 'No description'}</span>
          {r.site && <span>{r.site}</span>}
          {r.event_date && <span>{String(r.event_date).slice(0, 10)}</span>}
          {r.work_order_no && <span>Job {r.work_order_no}</span>}
          <span className="text-gray-300 tabular-nums">{money(r.line_cost, r.currency)}</span>
        </div>
      ))}
    </div>
  )
}

export default function DecisionsPanel() {
  const [view, setView] = useState('moved')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [country, setCountry] = useState('')
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [sort, setSort] = useState('value')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState(null)   // decisionKey with evidence open

  // Staged changes: {decisionKey: {row, category}}. Nothing is written until save.
  const [staged, setStaged] = useState({})
  const [savingAll, setSavingAll] = useState(false)
  const [preview, setPreview] = useState(null)
  const [applying, setApplying] = useState(false)
  const [lastBatch, setLastBatch] = useState(null)

  // Debounced: this reads every expense row, so a query per keystroke would be
  // a full scan per keystroke.
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
  const allItems = data?.items || []
  const flaggedCount = useMemo(() => allItems.filter(needsAttention).length, [allItems])
  const items = useMemo(() => {
    const base = onlyFlagged ? allItems.filter(needsAttention) : allItems
    return sortDecisions(base, sort)
  }, [allItems, onlyFlagged, sort])

  const stagedList = Object.values(staged)
  const stagedThatMove = stagedList.filter((s) => overrideMovesMoney(s.row, s.category)).length

  // Counts on the tabs come from the country summary, which covers the whole
  // window rather than the page of rows currently on screen.
  const viewCounts = useMemo(() => {
    const t = countries.reduce((a, c) => ({
      moved: a.moved + (Number(c.moved_rows) || 0),
      kept: a.kept + (Number(c.kept_rows) || 0),
      unlabelled: a.unlabelled + (Number(c.unlabelled_rows) || 0),
      all: a.all + (Number(c.total_rows) || 0),
    }), { moved: 0, kept: 0, unlabelled: 0, all: 0 })
    return t
  }, [countries])

  function stage(row, category) {
    const key = decisionKey(row)
    setStaged((s) => {
      const next = { ...s }
      if (!category) delete next[key]
      else next[key] = { row, category }
      return next
    })
    setNotice('')
  }

  async function saveStaged() {
    if (!stagedList.length) return
    setSavingAll(true); setError(''); setNotice('')
    let ok = 0
    try {
      for (const { row, category } of stagedList) {
        await setMaterial({ country: row.country, item_code: row.item_code, category, reviewed: true })
        ok += 1
      }
      setStaged({})
      setNotice(stagedThatMove
        ? `${ok} decision(s) saved. ${stagedThatMove} of them change a cost bucket - use "Apply to my data" to move the lines already loaded.`
        : `${ok} decision(s) saved. None of them change a cost bucket, so no total moves.`)
      await load()
    } catch (e) {
      setError(toUserMessage(e, `Saved ${ok} of ${stagedList.length}. The rest were not saved.`))
    } finally { setSavingAll(false) }
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
      <Note icon={Info} tone="accent">
        Your file files every line under its own Spare, Tyre or Oil column. The system decides from
        the item itself, so the two can disagree. This is every disagreement, with the money
        attached, and you can change any of them.
      </Note>

      {/* Per country, never added together: each reports in its own currency. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {countries.map((c) => (
          <Panel key={c.country}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-gray-200">{c.country}</h3>
              <span className="text-[11px] text-gray-500 tabular-nums">{money(c.total_value, c.currency)}</span>
            </div>
            <ProportionBar
              total={c.total_rows}
              segments={[
                { label: 'Moved', value: c.moved_rows, tone: 'warning' },
                { label: 'Kept', value: c.kept_rows, tone: 'good' },
                { label: 'Not stated', value: c.unlabelled_rows, tone: 'muted' },
              ]}
            />
            <dl className="mt-2.5 space-y-1 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-amber-300 inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-amber-500" /> Moved
                </dt>
                <dd className="text-gray-300 tabular-nums">
                  {num(c.moved_rows)} <span className="text-gray-600">({pct(c.moved_share)})</span> · {money(c.moved_value, c.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-emerald-300 inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-emerald-500" /> Kept
                </dt>
                <dd className="text-gray-300 tabular-nums">{num(c.kept_rows)} · {money(c.kept_value, c.currency)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-400 inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-gray-600" /> Not stated
                </dt>
                <dd className="text-gray-300 tabular-nums">{num(c.unlabelled_rows)} · {money(c.unlabelled_value, c.currency)}</dd>
              </div>
            </dl>
          </Panel>
        ))}
      </div>

      <Toolbar>
        <Segmented
          value={view}
          onChange={(v) => { setView(v); setExpanded(null) }}
          options={VIEWS.map((v) => ({ ...v, count: v.key === 'all' ? viewCounts.all : viewCounts[v.key] }))}
        />
        <div className="flex-1" />
        <Select
          value={country} onChange={setCountry} placeholder="All countries" className="w-36"
          options={countries.map((c) => ({ value: c.country, label: c.country }))}
        />
        <Select
          value={sort} onChange={setSort} className="w-40"
          options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Item code or description" className="w-56" />
        <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
        <Btn icon={Download} onClick={exportRows} disabled={!items.length}>Excel</Btn>
      </Toolbar>

      {flaggedCount > 0 && (
        <button
          onClick={() => setOnlyFlagged((v) => !v)}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
            onlyFlagged ? 'bg-amber-500/15 border-amber-600/60 text-amber-200'
                        : 'bg-amber-950/20 border-amber-800/40 text-amber-300 hover:bg-amber-950/40'}`}
        >
          <AlertTriangle size={13} />
          <span className="flex-1 text-left">
            {flaggedCount} of these were decided on weak evidence
          </span>
          <span className="text-[11px] opacity-80">{onlyFlagged ? 'Showing only these - clear' : 'Show only these'}</span>
        </button>
      )}

      {notice && (
        <Note icon={Check} tone="default"><span className="text-emerald-300">{notice}</span></Note>
      )}
      <ErrorState message={error} onRetry={load} />

      {/* Staged changes. Nothing has been written yet at this point. */}
      {stagedList.length > 0 && (
        <Panel tone="accent">
          <PanelHeader
            icon={ListChecks}
            title={`${stagedList.length} change${stagedList.length === 1 ? '' : 's'} ready to save`}
            subtitle={stagedThatMove
              ? `${stagedThatMove} of them move money between buckets. Nothing is written until you save.`
              : 'None of these change a cost bucket, so no total will move. Nothing is written until you save.'}
            actions={<>
              <Btn icon={Trash2} onClick={() => setStaged({})} disabled={savingAll}>Discard</Btn>
              <Btn variant="primary" icon={Check} onClick={saveStaged} busy={savingAll}>Save these</Btn>
            </>}
          />
          <ul className="space-y-1">
            {stagedList.map(({ row, category }) => {
              const cat = OVERRIDE_CATEGORIES.find((c) => c.value === category)
              return (
                <li key={decisionKey(row)} className="flex flex-wrap items-center gap-2 text-xs">
                  <Code>{row.item_code}</Code>
                  <span className="text-gray-600">{row.country}</span>
                  <Bucket b={row.we_said} />
                  <ArrowRight size={12} className="text-gray-600" />
                  <Badge tone="accent">{cat?.label || category}</Badge>
                  {!overrideMovesMoney(row, category) && (
                    <span className="text-[10px] text-gray-600">same bucket, no total changes</span>
                  )}
                  <button onClick={() => stage(row, '')} className="ml-auto text-gray-600 hover:text-gray-300" title="Remove">
                    <Undo2 size={12} />
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      {/* Applying is the only path that moves money already reported, so it
          previews first and stays undoable afterwards. */}
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <Layers size={15} className="text-gray-600 shrink-0" />
          <p className="text-xs text-gray-400 flex-1 min-w-[220px]">
            Saved decisions apply to new uploads immediately. Lines already loaded only move when you apply them.
          </p>
          {lastBatch && <Btn icon={Undo2} onClick={undoLast} busy={applying}>Undo last apply</Btn>}
          <Btn variant="primary" icon={Shuffle} onClick={runPreview} busy={applying}>Apply to my data</Btn>
        </div>
      </Panel>

      <Modal
        open={!!preview}
        title={`${num(preview?.rows_that_change)} line(s) would move`}
        subtitle="Nothing has changed yet. This is what applying would do."
        onClose={() => setPreview(null)}
        width="max-w-xl"
        footer={<>
          <Btn onClick={() => setPreview(null)} disabled={applying}>Cancel</Btn>
          <Btn variant="primary" onClick={confirmApply} busy={applying} disabled={!preview?.rows_that_change}>
            Yes, move them
          </Btn>
        </>}
      >
        {(preview?.moves || []).length === 0 ? (
          <EmptyState
            icon={Check}
            title="Nothing would change"
            reason="Every reviewed item is already in the bucket you chose for it."
          />
        ) : (
          <ul className="space-y-2">
            {(preview?.moves || []).map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
                <Badge tone="quiet">{m.country}</Badge>
                <span className="tabular-nums">{num(m.rows)} line(s)</span>
                <Bucket b={m.from_bucket} />
                <ArrowRight size={12} className="text-gray-600" />
                <Bucket b={m.to_bucket} />
                <span className="ml-auto tabular-nums text-gray-400">{num(m.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {loading ? (
        <LoadingState label="Reading the decisions behind your data" rows={6} />
      ) : !data || data.ok === false ? (
        <EmptyState
          icon={Inbox}
          title="This view is not available yet"
          reason="The database this app is pointed at does not have the decisions view installed."
        />
      ) : !items.length ? (
        <EmptyState
          icon={onlyFlagged ? Sparkles : Inbox}
          title={
            onlyFlagged ? 'Nothing here was decided on weak evidence'
              : term ? 'No item matches that search in this view'
                : view === 'moved' ? 'Nothing was moved'
                  : 'Nothing to show in this view'
          }
          reason={
            onlyFlagged ? 'Every decision in this view was made on a strong signal.'
              : term ? 'Try a shorter search, or a different view.'
                : view === 'moved' ? 'Every line is filed exactly where your file put it.'
                  : undefined
          }
          action={onlyFlagged ? <Btn onClick={() => setOnlyFlagged(false)}>Show everything</Btn> : undefined}
        />
      ) : (
        <Table>
          <THead>
            <Th>Item</Th>
            <Th>Your file said</Th>
            <Th>We filed it as</Th>
            <Th>Why</Th>
            <Th align="right">Lines</Th>
            <Th align="right">Value</Th>
            <Th>Change it to</Th>
          </THead>
          <tbody>
            {items.map((r) => {
              const key = decisionKey(r)
              const flag = needsAttention(r)
              const chosen = staged[key]?.category ?? (r.reviewed_category || '')
              const isOpen = expanded === key
              return [
                <Tr key={key} tone={flag ? 'warning' : undefined}>
                  <Td>
                    <button onClick={() => setExpanded(isOpen ? null : key)}
                      className="flex items-start gap-1.5 text-left group">
                      <ChevronRight size={12}
                        className={`mt-1 text-gray-600 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <span className="min-w-0">
                        <span className="block font-mono text-gray-200 group-hover:text-orange-300">{r.item_code}</span>
                        <span className="block text-gray-500 max-w-[300px] truncate" title={r.item_name}>{r.item_name}</span>
                        <span className="block text-[10px] text-gray-600">{r.country}</span>
                      </span>
                    </button>
                    {flag && (
                      <p className="text-[10px] text-amber-400 flex items-start gap-1 mt-1 max-w-[300px] pl-5">
                        <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {attentionReason(r)}
                      </p>
                    )}
                  </Td>
                  <Td><Bucket b={r.erp_said} /></Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Bucket b={r.we_said} />
                      {r.movement === 'moved' && <ArrowRight size={11} className="text-amber-500" />}
                    </div>
                  </Td>
                  <Td className="text-gray-400">
                    {reasonLabel(r.decided_by)}
                    {r.reviewed && <div className="mt-0.5"><Badge tone="good" icon={Check}>reviewed</Badge></div>}
                  </Td>
                  <Td align="right" className="text-gray-300 tabular-nums">{num(r.rows)}</Td>
                  <Td align="right" nowrap className="text-gray-300 tabular-nums">{money(r.value, r.currency)}</Td>
                  <Td>
                    <Select
                      value={chosen}
                      onChange={(v) => stage(r, v)}
                      placeholder="Leave as it is"
                      className="w-36"
                      options={OVERRIDE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
                    />
                    {staged[key] && <p className="text-[10px] text-orange-400 mt-1">Staged, not saved</p>}
                  </Td>
                </Tr>,
                isOpen && (
                  <tr key={`${key}-ev`} className="border-t border-gray-800/40 bg-gray-950/60">
                    <Td colSpan={7}>
                      <div className="pl-5 py-1 space-y-2">
                        <p className="text-xs text-gray-400">{movementSentence(r)}</p>
                        <LineEvidence country={r.country} itemCode={r.item_code} />
                      </div>
                    </Td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </Table>
      )}

      {allItems.length >= (data?.limit || 300) && (
        <p className="text-[11px] text-gray-500">
          Showing the {num(data.limit)} highest-value items. Search to reach the rest.
        </p>
      )}
    </div>
  )
}
