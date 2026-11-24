/**
 * OEM depth: what the parts manuals tell us beyond a part-number link.
 *  - Fitment: per manual, how many fleet assets carry its make and model. This
 *    is labelled evidence ("manual says X; fleet has N such assets"), never a
 *    claim that a part fits a machine.
 *  - Stock: on-hand stock by site for stored OEM links and for catalogue items
 *    that carry OEM numbers (catalogue -> ERP item -> balances).
 *  - Alternatives: propose "A can replace B" as a correction request on B.
 *    A second person approves it in Corrections; nothing is linked here.
 *  - Unmatched manual rows: rows with no proposal, each with exact-rule
 *    candidates only (equal part number, or every manual word present).
 * Plain English text (Arabic is deferred). Loads only when opened.
 */
import { useMemo, useState } from 'react'
import { Search, RefreshCw, Wrench, Boxes, Repeat, ListChecks, Send } from 'lucide-react'
import { loadOemCrossRef } from '../../lib/api/oemCrossRef'
import { loadFitmentSources, loadCatalogueStock, loadLinkStock, loadAllCatalogueReferences, proposeAlternative } from '../../lib/api/oemFitment'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { normalizePartNo } from '../../lib/inventory/oemCrossRef'
import {
  buildManualFitment, fitmentSentence, catalogueStockRows, linkStockRows, summarizeStockRows,
  existingAlternatives, ALT_RELATIONS, buildCandidateIndex, buildUnmatchedRows, filterUnmatched,
  summarizeUnmatched, UNMATCHED_FILTERS, BROAD_LIMIT,
} from '../../lib/inventory/oemFitment'
import { toUserMessage } from '../../lib/inventory/errorText'
import { KitTable } from '../commandCenter/kit'
import { useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, StatusPill, SearchBox, Field } from './InvUi'

const TABS = [
  { key: 'fitment', label: 'Fitment', icon: Wrench },
  { key: 'stock', label: 'Stock by site', icon: Boxes },
  { key: 'alternatives', label: 'Alternatives', icon: Repeat },
  { key: 'unmatched', label: 'Unmatched manual rows', icon: ListChecks },
]

const RULE_LABEL = {
  all: 'All rows', part_number: 'Equal part number', words: 'All words match', broad: 'Too many matches', none: 'No candidate',
}
const RULE_TONE = { part_number: 'good', words: 'info', broad: 'warn', none: 'muted' }
const fmtQty = (n) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'N/A')

function Sites({ sites }) {
  if (!sites?.length) return <span className="cc-na">No stock on hand</span>
  return (
    <span className="inv-mm-chips">
      {sites.map((s) => <span key={`${s.site}-${s.country}`} className="inv-chip">{s.site}: {fmtQty(s.qty)}{s.uom ? ` ${s.uom}` : ''}</span>)}
    </span>
  )
}

function Loading() { return <div className="cc-skel" style={{ height: 160 }} aria-busy="true" /> }

/* ── Fitment ─────────────────────────────────────────────────────────── */
function FitmentTab({ base, country }) {
  const q = useInvQuery(() => loadFitmentSources({ country }), [country])
  const [lookup, setLookup] = useState('')
  const entries = base.raw.entries
  const rowsPerManual = useMemo(() => {
    const m = new Map()
    for (const e of entries) m.set(e.manual_id, (m.get(e.manual_id) || 0) + 1)
    return m
  }, [entries])
  const fitment = useMemo(() => (q.data ? buildManualFitment(q.data) : []), [q.data])
  const byManual = useMemo(() => new Map(fitment.map((f) => [f.manual.id, f])), [fitment])

  // Item lookup: a manual part number, or a company SKU from a proposal / stored link.
  const lookupHits = useMemo(() => {
    const key = normalizePartNo(lookup)
    if (key.length < 3) return null
    const skuKeys = new Set()
    for (const p of base.proposals) {
      if (p.candidates.some((c) => normalizePartNo(c.canonical.company_sku) === key)) skuKeys.add(p.key)
    }
    const hits = entries.filter((e) => normalizePartNo(e.part_no) === key || skuKeys.has(`${String(e.country || '').toLowerCase()}|${normalizePartNo(e.part_no)}`))
    const manualIds = [...new Set(hits.map((e) => e.manual_id).filter(Boolean))]
    return { hits, manualIds }
  }, [lookup, entries, base.proposals])

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.loading && !q.data) return <Loading />
  return (
    <>
      <Note>Fitment is evidence, not a guarantee. A count means the fleet register records that make (and model). Most fleet assets have no model recorded, so a model count is a floor, not the real number.</Note>
      {q.data?.truncated && <Note tone="warn">The fleet register is larger than this screen reads, so the counts are incomplete.</Note>}
      <SearchBox value={lookup} onChange={setLookup} placeholder="Manual part number or company SKU" label="Which machines can this part be on?" />
      {lookupHits && (
        lookupHits.manualIds.length ? (
          <ul className="cc-card-sub" style={{ display: 'grid', gap: 6 }}>
            {lookupHits.manualIds.map((id) => {
              const f = byManual.get(id)
              const rows = lookupHits.hits.filter((e) => e.manual_id === id)
              return (
                <li key={id}>
                  <strong>{rows[0]?.part_no}</strong> {rows[0]?.description || ''} ({rows.length} row{rows.length === 1 ? '' : 's'} in the manual). {f ? fitmentSentence(f) : 'The manual for this row is not readable in your scope.'}
                </li>
              )
            })}
          </ul>
        ) : <p className="cc-card-sub">No manual row has this part number, and no catalogue item with this SKU is matched to a manual row.</p>
      )}
      {!fitment.length ? <div className="cc-empty">No parts manuals are loaded for this scope.</div> : (
        <KitTable compact rows={fitment} columns={[
          { key: 'manual', header: 'Manual', sortable: false, cell: (f) => (
            <span><strong>{[f.manual.manufacturer, f.model].filter(Boolean).join(' ') || 'Unnamed manual'}</strong>
              <span className="cc-card-sub" style={{ display: 'block' }}>{rowsPerManual.get(f.manual.id) || 0} parsed rows{f.manual.country ? `, ${f.manual.country}` : ''}</span></span>
          ) },
          { key: 'make', header: 'Same make in fleet', numeric: true, cell: (f) => f.makeAssets },
          { key: 'recorded', header: 'Model recorded', numeric: true, cell: (f) => f.modelRecorded },
          { key: 'model', header: 'Same model', numeric: true, cell: (f) => (f.basis === 'model' ? f.modelMatches : <span className="cc-na">No model code</span>) },
          { key: 'types', header: 'Same make, by vehicle type', sortable: false, cell: (f) => (
            <span className="inv-mm-chips">{Object.entries(f.byType).sort((a, b) => b[1] - a[1]).map(([k, n]) => <span key={k} className="inv-chip">{k}: {n}</span>)}</span>
          ) },
          { key: 'evidence', header: 'What this says', sortable: false, cell: (f) => (
            <span className="cc-card-sub">{fitmentSentence(f)}{f.matchedAssets.length ? ` Assets: ${f.matchedAssets.slice(0, 8).map((a) => a.asset_no).filter(Boolean).join(', ')}${f.matchedAssets.length > 8 ? '...' : ''}` : ''}</span>
          ) },
        ]} />
      )}
    </>
  )
}

/* ── Stock ───────────────────────────────────────────────────────────── */
function StockTab({ base }) {
  const oemAliases = base.raw.aliases
  const canonIds = useMemo(() => [...new Set(oemAliases.map((a) => a.canonical_id).filter(Boolean))], [oemAliases])
  const cat = useInvQuery(() => loadCatalogueStock(canonIds), [canonIds])
  const links = useInvQuery(() => loadLinkStock(base.raw.references), [base.raw.references])
  const [search, setSearch] = useState('')
  const [onlyStock, setOnlyStock] = useState(false)
  const catRows = useMemo(() => (cat.data ? catalogueStockRows({ canonicals: base.raw.canonicals, oemAliases, links: cat.data.links, balances: cat.data.balances }) : []), [cat.data, base.raw.canonicals, oemAliases])
  const linkRows = useMemo(() => (links.data ? linkStockRows({ references: base.raw.references, erpItems: links.data.erpItems, balances: links.data.balances }) : []), [links.data, base.raw.references])
  const sum = summarizeStockRows(catRows)
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const key = normalizePartNo(search)
    return catRows.filter((r) => (!onlyStock || r.total > 0) && (!q
      || `${r.canonical.company_sku || ''} ${r.canonical.description || ''}`.toLowerCase().includes(q)
      || (key && r.oemNumbers.some((n) => normalizePartNo(n).includes(key)))))
  }, [catRows, search, onlyStock])

  return (
    <>
      <h4 className="cc-card-title">Stored OEM links</h4>
      {links.error ? <ErrorNote error={links.error} onRetry={links.retry} />
        : links.loading && !links.data ? <Loading />
          : !linkRows.length ? <div className="cc-empty">No OEM link has been proposed or approved yet. Accept a match in the OEM cross-reference review above to create one.</div>
            : (
              <KitTable compact rows={linkRows} columns={[
                { key: 'oem', header: 'OEM part number', cell: (r) => <strong>{r.reference.oem_part_no}</strong>, sortValue: (r) => r.reference.oem_part_no },
                { key: 'item', header: 'ERP item', cell: (r) => (r.item ? `${r.item.item_code} ${r.item.item_name || ''}` : <span className="cc-na">Not readable</span>) },
                { key: 'status', header: 'Link', cell: (r) => <StatusPill value={r.reference.status} tone={r.reference.status === 'approved' ? 'good' : 'warn'} label={r.reference.status === 'approved' ? 'Approved' : 'Awaiting approval'} /> },
                { key: 'total', header: 'On hand', numeric: true, cell: (r) => fmtQty(r.total), sortValue: (r) => r.total },
                { key: 'sites', header: 'By site', sortable: false, cell: (r) => <Sites sites={r.sites} /> },
              ]} />
            )}
      <h4 className="cc-card-title" style={{ marginTop: 16 }}>Catalogue items that carry OEM numbers</h4>
      {cat.error ? <ErrorNote error={cat.error} onRetry={cat.retry} />
        : cat.loading && !cat.data ? <Loading />
          : (
            <>
              <p className="cc-card-sub">{sum.items} catalogue items carry an OEM number; {sum.linked} are linked to an ERP item; {sum.inStock} have stock on hand across {sum.sites} sites.</p>
              {cat.data?.truncated && <Note tone="warn">Some links or balances were not read in full, so a total may be low.</Note>}
              <div className="inv-toolbar">
                <SearchBox value={search} onChange={setSearch} placeholder="Company SKU, description or OEM number" label="Search catalogue stock" />
                <label className="cc-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> <span>Only items with stock</span>
                </label>
              </div>
              {!shown.length ? <div className="cc-empty">No catalogue item matches.</div> : (
                <KitTable rows={shown} columns={[
                  { key: 'sku', header: 'Company SKU', cell: (r) => <strong>{r.canonical.company_sku}</strong>, sortValue: (r) => r.canonical.company_sku },
                  { key: 'desc', header: 'Description', cell: (r) => r.canonical.description || '', sortValue: (r) => r.canonical.description },
                  { key: 'oem', header: 'OEM numbers', sortable: false, cell: (r) => <span className="inv-mm-chips">{r.oemNumbers.slice(0, 4).map((n) => <span key={n} className="inv-chip">{n}</span>)}{r.oemNumbers.length > 4 ? <span className="cc-card-sub">+{r.oemNumbers.length - 4}</span> : null}</span> },
                  { key: 'total', header: 'On hand', numeric: true, cell: (r) => (r.linked ? fmtQty(r.total) : <span className="cc-na">Not linked to an ERP item</span>), sortValue: (r) => r.total },
                  { key: 'sites', header: 'By site', sortable: false, cell: (r) => <Sites sites={r.sites} /> },
                ]} />
              )}
            </>
          )}
    </>
  )
}

/* ── Alternatives ───────────────────────────────────────────────────── */
function AlternativesTab({ base }) {
  const refs = useInvQuery(() => loadAllCatalogueReferences(), [])
  const [targetSearch, setTargetSearch] = useState('')
  const [target, setTarget] = useState(null)
  const [form, setForm] = useState({ value: '', relation: 'alternative', reason: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)
  const canonicals = base.raw.canonicals
  const byId = useMemo(() => new Map(canonicals.map((c) => [c.id, c])), [canonicals])
  const existing = useMemo(() => existingAlternatives(refs.data?.rows || []), [refs.data])
  const existingRows = useMemo(() => [...existing.entries()].flatMap(([cid, list]) => list.map((a) => ({ a, c: byId.get(cid) }))), [existing, byId])

  const targetHits = useMemo(() => {
    const q = targetSearch.trim().toLowerCase()
    if (q.length < 2) return []
    const key = normalizePartNo(targetSearch)
    return canonicals.filter((c) => (key && normalizePartNo(c.company_sku) === key) || `${c.company_sku || ''} ${c.description || ''}`.toLowerCase().includes(q)).slice(0, 8)
  }, [targetSearch, canonicals])

  // When A's value is a company SKU in the catalogue, name it so the approver sees both items.
  const replacementCanon = useMemo(() => {
    const key = normalizePartNo(form.value)
    return key ? canonicals.find((c) => normalizePartNo(c.company_sku) === key) || null : null
  }, [form.value, canonicals])

  const submit = async () => {
    setBusy(true); setErr(null); setDone(null)
    try {
      await proposeAlternative({
        target, relation: form.relation, reason: form.reason,
        replacement: { value: form.value, canonicalId: replacementCanon?.id || null, sku: replacementCanon?.company_sku || null, brand: replacementCanon?.brand || null },
      }, newIdempotencyKey())
      setDone(`Sent for approval. A second person approves or rejects it in Corrections; until then ${target.company_sku} is unchanged.`)
      setForm({ value: '', relation: 'alternative', reason: '' })
      refs.retry()
    } catch (e) {
      setErr(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Note>Record that part A can replace item B. The request is stored on B and waits for a second person in Corrections. You cannot approve your own request.</Note>
      <div className="inv-form-grid" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <Field label="B: the catalogue item that can be replaced" id="oemfit-alt-target">
          <input id="oemfit-alt-target" className="inv-input" value={target ? `${target.company_sku} ${target.description || ''}` : targetSearch}
            onChange={(e) => { setTarget(null); setTargetSearch(e.target.value) }} placeholder="Search company SKU or description" />
        </Field>
        <Field label="A: part number or company SKU of the replacement" id="oemfit-alt-value">
          <input id="oemfit-alt-value" className="inv-input" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} placeholder="e.g. 60211864" />
        </Field>
        <Field label="Relation" id="oemfit-alt-relation">
          <select id="oemfit-alt-relation" className="cc-select" value={form.relation} onChange={(e) => setForm((f) => ({ ...f, relation: e.target.value }))}>
            {ALT_RELATIONS.map((k) => <option key={k} value={k}>{k === 'alternative' ? 'A is an alternative to B' : 'B is superseded by A'}</option>)}
          </select>
        </Field>
        <Field label="Reason and evidence" id="oemfit-alt-reason" full>
          <input id="oemfit-alt-reason" className="inv-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Manual page, supplier notice or test result" />
        </Field>
      </div>
      {!target && targetHits.length > 0 && (
        <ul className="cc-card-sub" style={{ display: 'grid', gap: 4 }}>
          {targetHits.map((c) => (
            <li key={c.id}><button type="button" className="cc-btn-ghost" onClick={() => { setTarget(c); setTargetSearch('') }}><strong>{c.company_sku}</strong> {c.description}</button></li>
          ))}
        </ul>
      )}
      {replacementCanon && <p className="cc-card-sub">A is the catalogue item {replacementCanon.company_sku} {replacementCanon.description}.</p>}
      {err && <ErrorNote error={err} />}
      {done && <Note tone="good">{done}</Note>}
      <button type="button" className="inv-btn-accent" disabled={busy || !target || !form.value.trim() || !form.reason.trim()} onClick={submit}>
        <Send size={14} aria-hidden="true" /> Send for approval
      </button>
      <h4 className="cc-card-title" style={{ marginTop: 16 }}>Approved alternatives and superseded numbers</h4>
      {refs.error ? <ErrorNote error={refs.error} onRetry={refs.retry} />
        : refs.loading && !refs.data ? <Loading />
          : !existingRows.length ? <div className="cc-empty">No alternative or superseded reference is recorded yet. Pending requests are listed in Corrections.</div>
            : (
              <KitTable compact rows={existingRows} columns={[
                { key: 'b', header: 'Item (B)', cell: (r) => (r.c ? <span><strong>{r.c.company_sku}</strong> {r.c.description}</span> : <span className="cc-na">Not readable</span>) },
                { key: 'rel', header: 'Relation', cell: (r) => (r.a.alias_type === 'alternative' ? 'Alternative' : 'Superseded') },
                { key: 'a', header: 'Replacement (A)', cell: (r) => r.a.value },
                { key: 'state', header: 'State', cell: (r) => (r.a.ref_status === 'historical' ? 'Historical' : 'Active') },
                { key: 'src', header: 'Source', cell: (r) => r.a.source || '' },
              ]} />
            )}
    </>
  )
}

/* ── Unmatched manual rows ──────────────────────────────────────────── */
function UnmatchedTab({ base }) {
  const refs = useInvQuery(() => loadAllCatalogueReferences(), [])
  const [filters, setFilters] = useState({ rule: 'all', search: '' })
  const rows = useMemo(() => {
    if (!refs.data) return []
    const index = buildCandidateIndex({ canonicals: base.raw.canonicals, aliases: refs.data.rows, variants: base.raw.variants })
    const matchedKeys = new Set(base.proposals.map((p) => p.key))
    return buildUnmatchedRows({ entries: base.raw.entries, matchedKeys, index })
  }, [refs.data, base])
  const sum = summarizeUnmatched(rows)
  const shown = useMemo(() => filterUnmatched(rows, filters), [rows, filters])

  if (refs.error) return <ErrorNote error={refs.error} onRetry={refs.retry} />
  if (refs.loading && !refs.data) return <Loading />
  return (
    <>
      <Note>Candidates use two exact rules only: the part number is equal to a recorded number, or every word of the manual description appears in the catalogue description. When more than {BROAD_LIMIT} items qualify the row is marked as too broad and no list is shown. A candidate is a lead to check, not a match. To link one, record the OEM number on the item through Corrections.</Note>
      <p className="cc-card-sub">{sum.total} unmatched manual rows: {sum.part_number} with an equal part number, {sum.words} with word candidates, {sum.broad} too broad, {sum.none} with no candidate.</p>
      <div className="inv-toolbar" role="group" aria-label="Unmatched row filters">
        <label className="cc-field">
          <span>Candidate rule</span>
          <select className="cc-select" value={filters.rule} onChange={(e) => setFilters((f) => ({ ...f, rule: e.target.value }))}>
            {UNMATCHED_FILTERS.map((k) => <option key={k} value={k}>{RULE_LABEL[k]}</option>)}
          </select>
        </label>
        <SearchBox value={filters.search} onChange={(v) => setFilters((f) => ({ ...f, search: v }))} placeholder="Part number, description or assembly" label="Search unmatched rows" />
      </div>
      {!shown.length ? <div className="cc-empty">{rows.length ? 'No row matches these filters.' : 'Every manual row has a proposal.'}</div> : (
        <KitTable rows={shown} columns={[
          { key: 'part', header: 'Manual part number', cell: (r) => (
            <span><strong>{r.entry.part_no}</strong>
              <span className="cc-card-sub" style={{ display: 'block' }}>{r.entry.description || ''}{r.entry.assembly_heading ? `, ${r.entry.assembly_heading}` : ''}{r.entry.manual?.model ? `, ${r.entry.manual.model}` : ''}{r.entry.source_pdf_page ? `, page ${r.entry.source_pdf_page}` : ''}</span></span>
          ), sortValue: (r) => r.partKey },
          { key: 'rule', header: 'Rule', cell: (r) => <StatusPill value={r.rule} tone={RULE_TONE[r.rule]} label={r.rule === 'broad' ? `${RULE_LABEL.broad} (${r.broadCount})` : RULE_LABEL[r.rule]} />, sortValue: (r) => r.rule },
          { key: 'cand', header: 'Candidates', sortable: false, cell: (r) => (r.candidates.length ? (
            <span style={{ display: 'grid', gap: 4 }}>
              {r.candidates.map((c) => (
                <span key={c.canonical.id}><strong>{c.canonical.company_sku}</strong> {c.canonical.description}
                  <span className="cc-card-sub"> ({c.rule === 'part_number' ? c.evidence.map((x) => x.field.replace(/_/g, ' ')).join(', ') : `words: ${r.words.join(' ')}`})</span></span>
              ))}
              {r.rule === 'words' && r.broadCount > r.candidates.length && <span className="cc-card-sub">{r.broadCount - r.candidates.length} more qualify; the most specific are shown.</span>}
            </span>
          ) : <span className="cc-na">{r.rule === 'broad' ? 'Description too general' : 'None'}</span>) },
        ]} />
      )}
    </>
  )
}

export default function OemFitmentPanel({ scope }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('fitment')
  const country = scope?.country && scope.country !== 'All' ? scope.country : undefined
  const q = useInvQuery(() => (open ? loadOemCrossRef({ country }) : Promise.resolve(null)), [open, country])

  return (
    <SectionCard
      title="OEM fitment, stock and alternatives"
      sub="Which machines a manual covers, where OEM-numbered stock sits, and the manual rows still waiting for a match."
      action={open ? (
        <button type="button" className="cc-btn-ghost" onClick={q.retry} disabled={q.loading}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      ) : (
        <button type="button" className="inv-btn-outline" onClick={() => setOpen(true)}>
          <Search size={14} aria-hidden="true" /> Open
        </button>
      )}
    >
      {!open ? <p className="cc-card-sub">Opens on demand: it reads the parts manuals, the fleet register and stock balances.</p>
        : q.error ? <ErrorNote error={q.error} onRetry={q.retry} />
          : q.data?.status === 'not_provisioned' ? <NotSetUp what="OEM fitment" />
            : q.loading && !q.data ? <Loading />
              : !q.data ? null : (
                <>
                  {q.data.truncated?.length > 0 && <Note tone="warn">Some source tables were larger than this screen reads, so counts may be incomplete.</Note>}
                  <div className="inv-toptabs inv-toptabs-sub" role="tablist" aria-label="OEM depth views">
                    {TABS.map(({ key, label, icon: Icon }) => (
                      <button key={key} type="button" role="tab" aria-selected={tab === key} className="inv-toptab" onClick={() => setTab(key)}>
                        <Icon size={15} aria-hidden="true" /> <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <div role="tabpanel">
                    {tab === 'fitment' && <FitmentTab base={q.data} country={country} />}
                    {tab === 'stock' && <StockTab base={q.data} />}
                    {tab === 'alternatives' && <AlternativesTab base={q.data} />}
                    {tab === 'unmatched' && <UnmatchedTab base={q.data} />}
                  </div>
                </>
              )}
    </SectionCard>
  )
}
