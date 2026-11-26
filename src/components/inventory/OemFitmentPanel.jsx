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
 * Text comes from the wmsparts locale namespace. Loads only when opened.
 */
import { useMemo, useState } from 'react'
import { Search, RefreshCw, Wrench, Boxes, Repeat, ListChecks, Send } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
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
  { key: 'fitment', icon: Wrench },
  { key: 'stock', icon: Boxes },
  { key: 'alternatives', icon: Repeat },
  { key: 'unmatched', icon: ListChecks },
]
const RULE_TONE = { part_number: 'good', words: 'info', broad: 'warn', none: 'muted' }
const fmtQty = (n, na = '') => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : na)

function Sites({ sites }) {
  const { t } = useLanguage()
  if (!sites?.length) return <span className="cc-na">{t('wmsparts.fitment.noStockOnHand')}</span>
  return (
    <span className="inv-mm-chips">
      {sites.map((s) => <span key={`${s.site}-${s.country}`} className="inv-chip">{s.site}: {fmtQty(s.qty, t('wmsparts.common.na'))}{s.uom ? ` ${s.uom}` : ''}</span>)}
    </span>
  )
}

function Loading() { return <div className="cc-skel" style={{ height: 160 }} aria-busy="true" /> }

/* ── Fitment ─────────────────────────────────────────────────────────── */
function FitmentTab({ base, country }) {
  const { t } = useLanguage()
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
      <Note>{t('wmsparts.fitment.evidenceNote')}</Note>
      {q.data?.truncated && <Note tone="warn">{t('wmsparts.fitment.fleetTruncated')}</Note>}
      <SearchBox value={lookup} onChange={setLookup} placeholder={t('wmsparts.fitment.lookupPh')} label={t('wmsparts.fitment.lookup')} />
      {lookupHits && (
        lookupHits.manualIds.length ? (
          <ul className="cc-card-sub" style={{ display: 'grid', gap: 6 }}>
            {lookupHits.manualIds.map((id) => {
              const f = byManual.get(id)
              const rows = lookupHits.hits.filter((e) => e.manual_id === id)
              return (
                <li key={id}>
                  <strong dir="ltr">{rows[0]?.part_no}</strong> {rows[0]?.description || ''} ({t(rows.length === 1 ? 'wmsparts.fitment.rowsOne' : 'wmsparts.fitment.rowsMany', { n: rows.length })}). {f ? fitmentSentence(f) : t('wmsparts.fitment.manualNotReadable')}
                </li>
              )
            })}
          </ul>
        ) : <p className="cc-card-sub">{t('wmsparts.fitment.lookupNone')}</p>
      )}
      {!fitment.length ? <div className="cc-empty">{t('wmsparts.fitment.noManuals')}</div> : (
        <KitTable compact rows={fitment} columns={[
          { key: 'manual', header: t('wmsparts.fitment.col.manual'), sortable: false, cell: (f) => (
            <span><strong>{[f.manual.manufacturer, f.model].filter(Boolean).join(' ') || t('wmsparts.fitment.unnamedManual')}</strong>
              <span className="cc-card-sub" style={{ display: 'block' }}>{t('wmsparts.fitment.parsedRows', { n: rowsPerManual.get(f.manual.id) || 0 })}{f.manual.country ? `, ${f.manual.country}` : ''}</span></span>
          ) },
          { key: 'make', header: t('wmsparts.fitment.col.make'), numeric: true, cell: (f) => f.makeAssets },
          { key: 'recorded', header: t('wmsparts.fitment.col.recorded'), numeric: true, cell: (f) => f.modelRecorded },
          { key: 'model', header: t('wmsparts.fitment.col.model'), numeric: true, cell: (f) => (f.basis === 'model' ? f.modelMatches : <span className="cc-na">{t('wmsparts.fitment.noModelCode')}</span>) },
          { key: 'types', header: t('wmsparts.fitment.col.types'), sortable: false, cell: (f) => (
            <span className="inv-mm-chips">{Object.entries(f.byType).sort((a, b) => b[1] - a[1]).map(([k, n]) => <span key={k} className="inv-chip">{k}: {n}</span>)}</span>
          ) },
          { key: 'evidence', header: t('wmsparts.fitment.col.evidence'), sortable: false, cell: (f) => (
            <span className="cc-card-sub">{fitmentSentence(f)}{f.matchedAssets.length ? ` ${t('wmsparts.fitment.assetsPrefix')} ${f.matchedAssets.slice(0, 8).map((a) => a.asset_no).filter(Boolean).join(', ')}${f.matchedAssets.length > 8 ? '...' : ''}` : ''}</span>
          ) },
        ]} />
      )}
    </>
  )
}

/* ── Stock ───────────────────────────────────────────────────────────── */
function StockTab({ base }) {
  const { t } = useLanguage()
  const na = t('wmsparts.common.na')
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
      <h4 className="cc-card-title">{t('wmsparts.fitment.storedLinks')}</h4>
      {links.error ? <ErrorNote error={links.error} onRetry={links.retry} />
        : links.loading && !links.data ? <Loading />
          : !linkRows.length ? <div className="cc-empty">{t('wmsparts.fitment.noLinks')}</div>
            : (
              <KitTable compact rows={linkRows} columns={[
                { key: 'oem', header: t('wmsparts.fitment.col.oemPart'), cell: (r) => <strong dir="ltr">{r.reference.oem_part_no}</strong>, sortValue: (r) => r.reference.oem_part_no },
                { key: 'item', header: t('wmsparts.approved.col.erpItem'), cell: (r) => (r.item ? `${r.item.item_code} ${r.item.item_name || ''}` : <span className="cc-na">{t('wmsparts.common.notReadable')}</span>) },
                { key: 'status', header: t('wmsparts.fitment.col.link'), cell: (r) => <StatusPill value={r.reference.status} tone={r.reference.status === 'approved' ? 'good' : 'warn'} label={r.reference.status === 'approved' ? t('wmsparts.common.approved') : t('wmsparts.common.awaitingApproval')} /> },
                { key: 'total', header: t('wmsparts.common.onHand'), numeric: true, cell: (r) => fmtQty(r.total, na), sortValue: (r) => r.total },
                { key: 'sites', header: t('wmsparts.fitment.col.bySite'), sortable: false, cell: (r) => <Sites sites={r.sites} /> },
              ]} />
            )}
      <h4 className="cc-card-title" style={{ marginTop: 16 }}>{t('wmsparts.fitment.catalogueWithOem')}</h4>
      {cat.error ? <ErrorNote error={cat.error} onRetry={cat.retry} />
        : cat.loading && !cat.data ? <Loading />
          : (
            <>
              <p className="cc-card-sub">{t('wmsparts.fitment.stockSummary', { items: sum.items, linked: sum.linked, inStock: sum.inStock, sites: sum.sites })}</p>
              {cat.data?.truncated && <Note tone="warn">{t('wmsparts.fitment.stockTruncated')}</Note>}
              <div className="inv-toolbar">
                <SearchBox value={search} onChange={setSearch} placeholder={t('wmsparts.fitment.stockSearchPh')} label={t('wmsparts.fitment.stockSearch')} />
                <label className="cc-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> <span>{t('wmsparts.fitment.onlyStock')}</span>
                </label>
              </div>
              {!shown.length ? <div className="cc-empty">{t('wmsparts.fitment.noCatalogueMatch')}</div> : (
                <KitTable rows={shown} columns={[
                  { key: 'sku', header: t('wmsparts.fitment.col.sku'), cell: (r) => <strong dir="ltr">{r.canonical.company_sku}</strong>, sortValue: (r) => r.canonical.company_sku },
                  { key: 'desc', header: t('wmsparts.common.description'), cell: (r) => r.canonical.description || '', sortValue: (r) => r.canonical.description },
                  { key: 'oem', header: t('wmsparts.detail.oemNumbers'), sortable: false, cell: (r) => <span className="inv-mm-chips">{r.oemNumbers.slice(0, 4).map((n) => <span key={n} className="inv-chip">{n}</span>)}{r.oemNumbers.length > 4 ? <span className="cc-card-sub">+{r.oemNumbers.length - 4}</span> : null}</span> },
                  { key: 'total', header: t('wmsparts.common.onHand'), numeric: true, cell: (r) => (r.linked ? fmtQty(r.total, na) : <span className="cc-na">{t('wmsparts.fitment.notLinkedErp')}</span>), sortValue: (r) => r.total },
                  { key: 'sites', header: t('wmsparts.fitment.col.bySite'), sortable: false, cell: (r) => <Sites sites={r.sites} /> },
                ]} />
              )}
            </>
          )}
    </>
  )
}

/* ── Alternatives ───────────────────────────────────────────────────── */
function AlternativesTab({ base }) {
  const { t } = useLanguage()
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
      setDone(t('wmsparts.fitment.altSent', { sku: target.company_sku }))
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
      <Note>{t('wmsparts.fitment.altNote')}</Note>
      <div className="inv-form-grid" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <Field label={t('wmsparts.fitment.altTarget')} id="oemfit-alt-target">
          <input id="oemfit-alt-target" className="inv-input" value={target ? `${target.company_sku} ${target.description || ''}` : targetSearch}
            onChange={(e) => { setTarget(null); setTargetSearch(e.target.value) }} placeholder={t('wmsparts.fitment.altTargetPh')} />
        </Field>
        <Field label={t('wmsparts.fitment.altValue')} id="oemfit-alt-value">
          <input id="oemfit-alt-value" className="inv-input" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} placeholder={t('wmsparts.fitment.altValuePh')} dir="ltr" />
        </Field>
        <Field label={t('wmsparts.common.relation')} id="oemfit-alt-relation">
          <select id="oemfit-alt-relation" className="cc-select" value={form.relation} onChange={(e) => setForm((f) => ({ ...f, relation: e.target.value }))}>
            {ALT_RELATIONS.map((k) => <option key={k} value={k}>{k === 'alternative' ? t('wmsparts.fitment.relAlternative') : t('wmsparts.fitment.relSuperseded')}</option>)}
          </select>
        </Field>
        <Field label={t('wmsparts.fitment.altReason')} id="oemfit-alt-reason" full>
          <input id="oemfit-alt-reason" className="inv-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t('wmsparts.fitment.altReasonPh')} />
        </Field>
      </div>
      {!target && targetHits.length > 0 && (
        <ul className="cc-card-sub" style={{ display: 'grid', gap: 4 }}>
          {targetHits.map((c) => (
            <li key={c.id}><button type="button" className="cc-btn-ghost" onClick={() => { setTarget(c); setTargetSearch('') }}><strong>{c.company_sku}</strong> {c.description}</button></li>
          ))}
        </ul>
      )}
      {replacementCanon && <p className="cc-card-sub">{t('wmsparts.fitment.altIsCatalogue', { sku: replacementCanon.company_sku, description: replacementCanon.description || '' })}</p>}
      {err && <ErrorNote error={err} />}
      {done && <Note tone="good">{done}</Note>}
      <button type="button" className="inv-btn-accent" disabled={busy || !target || !form.value.trim() || !form.reason.trim()} onClick={submit}>
        <Send size={14} aria-hidden="true" /> {t('wmsparts.common.sendForApproval')}
      </button>
      <h4 className="cc-card-title" style={{ marginTop: 16 }}>{t('wmsparts.fitment.altApproved')}</h4>
      {refs.error ? <ErrorNote error={refs.error} onRetry={refs.retry} />
        : refs.loading && !refs.data ? <Loading />
          : !existingRows.length ? <div className="cc-empty">{t('wmsparts.fitment.altNone')}</div>
            : (
              <KitTable compact rows={existingRows} columns={[
                { key: 'b', header: t('wmsparts.fitment.col.itemB'), cell: (r) => (r.c ? <span><strong dir="ltr">{r.c.company_sku}</strong> {r.c.description}</span> : <span className="cc-na">{t('wmsparts.common.notReadable')}</span>) },
                { key: 'rel', header: t('wmsparts.common.relation'), cell: (r) => (r.a.alias_type === 'alternative' ? t('wmsparts.fitment.alternative') : t('wmsparts.fitment.superseded')) },
                { key: 'a', header: t('wmsparts.fitment.col.replacementA'), cell: (r) => <span dir="ltr">{r.a.value}</span> },
                { key: 'state', header: t('wmsparts.fitment.col.state'), cell: (r) => (r.a.ref_status === 'historical' ? t('wmsparts.fitment.historical') : t('wmsparts.fitment.active')) },
                { key: 'src', header: t('wmsparts.common.source'), cell: (r) => r.a.source || '' },
              ]} />
            )}
    </>
  )
}

/* ── Unmatched manual rows ──────────────────────────────────────────── */
function UnmatchedTab({ base }) {
  const { t } = useLanguage()
  const ruleLabel = (k) => t(`wmsparts.fitment.rule.${k}`)
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
      <Note>{t('wmsparts.fitment.unmatchedNote', { limit: BROAD_LIMIT })}</Note>
      <p className="cc-card-sub">{t('wmsparts.fitment.unmatchedSummary', { total: sum.total, part: sum.part_number, words: sum.words, broad: sum.broad, none: sum.none })}</p>
      <div className="inv-toolbar" role="group" aria-label={t('wmsparts.fitment.unmatchedFilters')}>
        <label className="cc-field">
          <span>{t('wmsparts.fitment.candidateRule')}</span>
          <select className="cc-select" value={filters.rule} onChange={(e) => setFilters((f) => ({ ...f, rule: e.target.value }))}>
            {UNMATCHED_FILTERS.map((k) => <option key={k} value={k}>{ruleLabel(k)}</option>)}
          </select>
        </label>
        <SearchBox value={filters.search} onChange={(v) => setFilters((f) => ({ ...f, search: v }))} placeholder={t('wmsparts.fitment.unmatchedSearchPh')} label={t('wmsparts.fitment.unmatchedSearch')} />
      </div>
      {!shown.length ? <div className="cc-empty">{rows.length ? t('wmsparts.fitment.noRowMatch') : t('wmsparts.fitment.allProposed')}</div> : (
        <KitTable rows={shown} columns={[
          { key: 'part', header: t('wmsparts.fitment.col.manualPart'), cell: (r) => (
            <span><strong dir="ltr">{r.entry.part_no}</strong>
              <span className="cc-card-sub" style={{ display: 'block' }}>{r.entry.description || ''}{r.entry.assembly_heading ? `, ${r.entry.assembly_heading}` : ''}{r.entry.manual?.model ? `, ${r.entry.manual.model}` : ''}{r.entry.source_pdf_page ? `, ${t('wmsparts.fitment.page', { n: r.entry.source_pdf_page })}` : ''}</span></span>
          ), sortValue: (r) => r.partKey },
          { key: 'rule', header: t('wmsparts.fitment.col.rule'), cell: (r) => <StatusPill value={r.rule} tone={RULE_TONE[r.rule]} label={r.rule === 'broad' ? `${ruleLabel('broad')} (${r.broadCount})` : ruleLabel(r.rule)} />, sortValue: (r) => r.rule },
          { key: 'cand', header: t('wmsparts.fitment.col.candidates'), sortable: false, cell: (r) => (r.candidates.length ? (
            <span style={{ display: 'grid', gap: 4 }}>
              {r.candidates.map((c) => (
                <span key={c.canonical.id}><strong dir="ltr">{c.canonical.company_sku}</strong> {c.canonical.description}
                  <span className="cc-card-sub"> ({c.rule === 'part_number' ? c.evidence.map((x) => x.field.replace(/_/g, ' ')).join(', ') : t('wmsparts.fitment.wordsValue', { words: r.words.join(' ') })})</span></span>
              ))}
              {r.rule === 'words' && r.broadCount > r.candidates.length && <span className="cc-card-sub">{t('wmsparts.fitment.moreQualify', { n: r.broadCount - r.candidates.length })}</span>}
            </span>
          ) : <span className="cc-na">{r.rule === 'broad' ? t('wmsparts.fitment.tooGeneral') : t('wmsparts.common.none')}</span>) },
        ]} />
      )}
    </>
  )
}

export default function OemFitmentPanel({ scope }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('fitment')
  const country = scope?.country && scope.country !== 'All' ? scope.country : undefined
  const q = useInvQuery(() => (open ? loadOemCrossRef({ country }) : Promise.resolve(null)), [open, country])

  return (
    <SectionCard
      title={t('wmsparts.fitment.title')}
      sub={t('wmsparts.fitment.sub')}
      action={open ? (
        <button type="button" className="cc-btn-ghost" onClick={q.retry} disabled={q.loading}>
          <RefreshCw size={14} aria-hidden="true" /> {t('wmsparts.common.refresh')}
        </button>
      ) : (
        <button type="button" className="inv-btn-outline" onClick={() => setOpen(true)}>
          <Search size={14} aria-hidden="true" /> {t('wmsparts.common.open')}
        </button>
      )}
    >
      {!open ? <p className="cc-card-sub">{t('wmsparts.fitment.closedNote')}</p>
        : q.error ? <ErrorNote error={q.error} onRetry={q.retry} />
          : q.data?.status === 'not_provisioned' ? <NotSetUp what={t('wmsparts.fitment.what')} />
            : q.loading && !q.data ? <Loading />
              : !q.data ? null : (
                <>
                  {q.data.truncated?.length > 0 && <Note tone="warn">{t('wmsparts.fitment.sourceTruncated')}</Note>}
                  <div className="inv-toptabs inv-toptabs-sub" role="tablist" aria-label={t('wmsparts.fitment.viewsLabel')}>
                    {TABS.map(({ key, icon: Icon }) => (
                      <button key={key} type="button" role="tab" aria-selected={tab === key} className="inv-toptab" onClick={() => setTab(key)}>
                        <Icon size={15} aria-hidden="true" /> <span>{t(`wmsparts.fitment.tab.${key}`)}</span>
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
