/**
 * Material Master: one company material, every way it is identified (company
 * SKU, OEM part number, manufacturer / aftermarket part numbers), where it is
 * stocked and what is waiting for correction.
 *
 * The list is the server-paged company catalogue (material_canonical) with
 * brand, part type (from material_variants), fitment, key specs, posted stock
 * (v_inv_balances, matched on item code = company SKU) and opening stock still
 * waiting for approval (opening_balance_lines in draft / submitted batches),
 * looked up for the visible page only. Reads only: listMaterialCatalog,
 * inv_material_search (company-wide, RLS decides which stores the caller sees),
 * physical_inventory_photos and material_correction_requests. Proposing a material and deciding a
 * correction use the existing flows and RPCs; nothing is written here
 * directly. Unknown values print N/A.
 * The OEM cross-reference review (OemCrossRefPanel) proposes OEM-manual to
 * material links; a person accepts each one through inv_compat_propose and a
 * second person decides it through inv_compat_decide.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Search, ScanLine, Plus, Copy, Check, Package, CheckCircle2, Image as ImageIcon, FileText, Link2, History, Wrench,
} from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import {
  searchMaterials, getMaterial, listPhotos, listCorrections, listMaterialCatalog, loadMaterialCatalogDetail, loadMaterialCatalogFacets,
} from '../../lib/api/physicalInventory'
import {
  classifyMaterial, oemPartNumber, manufacturerPartNumber, alternativeReferences, storeAvailability, crossLocationStock, referenceOf,
} from '../../lib/inventory/materialMasterView'
import {
  PART_TYPE_FILTERS, MATERIAL_STATUSES, STOCK_FILTERS, partTypeTone, enrichMaterials, catalogFacets,
} from '../../lib/inventory/materialCatalogView'
import { toUserMessage } from '../../lib/inventory/errorText'
import CodeScanCamera, { codeScanSupported } from './CodeScanCamera'
import OemCrossRefPanel from './OemCrossRefPanel'
import OemFitmentPanel from './OemFitmentPanel'
import { CorrectionRows, CorrectionDetail } from './PhysicalInventoryReview'
import { KitTable, Pager } from '../commandCenter/kit'
import { useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, StatusPill, fmtDateTime } from './InvUi'

const DETAIL_TABS = ['availability', 'references', 'compatibility', 'photos', 'history', 'corrections', 'documents']
const na = (v) => (v === null || v === undefined || v === '' ? 'N/A' : v)
const n = (v) => Number(v || 0).toLocaleString('en-US')

function CopyButton({ value, label, t }) {
  const [done, setDone] = useState(false)
  if (!value) return null
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(String(value))
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch { /* clipboard refused: nothing to do */ }
  }
  return (
    <button type="button" className="inv-copy" onClick={copy} aria-label={t('inventory.mm.copy', { what: label })} title={t('inventory.mm.copy', { what: label })}>
      {done ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  )
}

/** A catalogue row in the same shape as a search result, plus the catalogue lookups. */
const fromCatalog = (m) => ({
  ...m, canonical_id: m.id, references: [], variants: [], availability_unassigned: [], browse: true,
})

const notStated = (v, t) => (v === null || v === undefined || v === '' ? t('inventory.mm.cat.notStated') : v)

function PartTypeBadge({ type, t }) {
  if (type === null || type === undefined) return <span className="cc-na">N/A</span>
  return <StatusPill value={type} tone={partTypeTone(type)} label={t(`inventory.mm.cat.type.${type}`)} />
}

function Chips({ r, t }) {
  const c = classifyMaterial(r)
  return (
    <span className="inv-mm-chips">
      {r.browse ? <PartTypeBadge type={r.partType} t={t} /> : (
        <>
          {c.genuine && <span className="inv-chip inv-chip-accent inv-chip-oem">{t('inventory.mm.filter.genuine')}</span>}
          {c.aftermarket && <span className="inv-chip inv-chip-accent inv-chip-am">{t('inventory.mm.filter.aftermarket')}</span>}
          {c.unverified && <span className="inv-chip">{t('inventory.mm.filter.unverified')}</span>}
        </>
      )}
      {r.category && <span className="inv-chip">{r.category}{r.subCategory ? ` / ${r.subCategory}` : ''}</span>}
    </span>
  )
}

function StockSummary({ r, t }) {
  return (
    <span className="inv-mm-chips">
      <span className="inv-chip">{r.posted ? t('inventory.mm.cat.stock.summaryPosted', { n: n(r.posted.onHand) }) : t('inventory.mm.cat.stock.summaryPosted', { n: 'N/A' })}</span>
      {r.pending === null ? <span className="inv-chip">{t('inventory.mm.cat.stock.summaryPending', { n: 'N/A' })}</span>
        : r.pending.qty > 0 ? <span className="inv-chip inv-chip-accent">{t('inventory.mm.cat.stock.summaryPending', { n: n(r.pending.qty) })}</span> : null}
    </span>
  )
}

function ItemCard({ r, selected, onSelect, t }) {
  return (
    <button type="button" className="inv-mm-card" aria-pressed={selected} onClick={() => onSelect(r)}>
      <span className="inv-mm-thumb" aria-hidden="true"><Package size={26} /></span>
      <span className="inv-mm-card-body">
        <span className="inv-mm-card-title">
          <b>{na(r.description)}</b>
          <StatusPill value={r.status} tone={r.status === 'active' ? 'good' : r.status === 'proposed' ? 'warn' : 'muted'}
            label={t(`inventory.mm.status.${r.status}`)} />
        </span>
        <span className={r.company_sku ? 'inv-mm-sku inv-mono' : 'inv-mm-sku'} dir={r.company_sku ? 'ltr' : undefined}>{r.company_sku || t('inventory.pi.common.noCompanySku')}</span>
        <span className="cc-card-sub">{t('inventory.mm.cat.brand')}: {notStated(r.brandLine, t)}</span>
        <Chips r={r} t={t} />
        <StockSummary r={r} t={t} />
      </span>
    </button>
  )
}

function Facts({ r, cat, t }) {
  const oem = cat?.oem?.length ? cat.oem.join(', ') : oemPartNumber(r)
  const mpn = manufacturerPartNumber(r)
  const types = cat?.partTypes
  const rows = [
    [t('inventory.mm.f.companySku'), r.company_sku, true],
    [t('inventory.mm.cat.brand'), notStated(cat?.brandLine ?? ([r.manufacturer, r.brand].filter(Boolean).join(' / ') || null), t)],
    [t('inventory.mm.cat.partType'), types === null || types === undefined ? null
      : (types.length ? types.map((k) => t(`inventory.mm.cat.type.${k}`)).join(', ') : t('inventory.mm.cat.type.not_stated'))],
    [t('inventory.mm.cat.oemNumbers'), cat?.oem && !cat.oem.length && !oem ? t('inventory.mm.cat.notStated') : oem, true],
    [t('inventory.mm.f.mpn'), mpn, true],
    [t('inventory.mm.cat.fitsVehicle'), notStated(cat?.fitsVehicle, t)],
    [t('inventory.mm.f.category'), r.category],
    [t('inventory.mm.cat.subCategory'), notStated(cat?.subCategory, t)],
    [t('inventory.mm.cat.itemType'), cat?.itemType],
    [t('inventory.mm.f.uom'), r.base_uom],
    ...(cat?.specList || []).map(([k, v]) => [t(`inventory.mm.cat.spec.${k}`), v]),
    [t('inventory.mm.f.barcode'), referenceOf(r, 'barcode'), true],
    [t('inventory.mm.f.erp'), (r.erp_skus || []).map((e) => `${e.item_code}${e.country ? ` (${e.country})` : ''}`).join(', ') || null, false, true],
    [t('inventory.mm.cat.originalDescription'), cat?.originalDescription, false, true],
  ]
  return (
    <dl className="inv-dl">
      {rows.map(([k, v, copy, ltr]) => (
        <div key={k} className="inv-dl-row">
          <dt>{k}</dt>
          <dd><span className={copy ? 'inv-mono' : undefined} dir={copy || ltr ? 'ltr' : undefined}>{na(v)}</span>{copy && <CopyButton value={v} label={k} t={t} />}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Posted stock per store, and opening stock still waiting for approval, kept apart. */
function StockOnHand({ cat, t }) {
  const posted = cat?.posted
  const pending = cat?.pending
  return (
    <div className="inv-hub" style={{ gap: 12 }}>
      <h3 className="inv-h3">{t('inventory.mm.cat.stock.posted')}</h3>
      {posted === null || posted === undefined ? <p className="cc-na">{t('inventory.mm.cat.stock.unknown')}</p>
        : !posted.sites.length ? <p className="cc-na">{t('inventory.mm.cat.stock.postedNone')}</p> : (
          <div className="cc-et inv-scroll">
            <table>
              <thead><tr>
                <th>{t('inventory.mm.cat.stock.site')}</th>
                <th className="inv-num">{t('inventory.mm.cat.stock.onHand')}</th>
                <th className="inv-num">{t('inventory.mm.cat.stock.reserved')}</th>
              </tr></thead>
              <tbody>
                {posted.sites.map((s) => (
                  <tr key={s.site}><td><b>{s.site}</b>{s.country ? <small className="cc-card-sub"> {s.country}</small> : null}</td>
                    <td className="inv-num">{n(s.onHand)}</td><td className="inv-num">{n(s.reserved)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr>
                <th>{t('inventory.mm.total')}{posted.uom ? ` (${posted.uom})` : posted.mixedUom ? ` (${t('inventory.mm.cat.stock.mixedUom')})` : ''}</th>
                <th className="inv-num">{n(posted.onHand)}</th><th className="inv-num">{n(posted.reserved)}</th>
              </tr></tfoot>
            </table>
          </div>
        )}
      <h3 className="inv-h3">{t('inventory.mm.cat.stock.pending')}</h3>
      {pending === null || pending === undefined ? <p className="cc-na">{t('inventory.mm.cat.stock.unknown')}</p>
        : !pending.sites.length ? <p className="cc-na">{t('inventory.mm.cat.stock.pendingNone')}</p> : (
          <>
            <Note tone="warn">{t('inventory.mm.cat.stock.pendingNote', { batches: n(pending.batches) })}</Note>
            <div className="cc-et inv-scroll">
              <table>
                <thead><tr>
                  <th>{t('inventory.mm.cat.stock.site')}</th>
                  <th>{t('inventory.mm.cat.stock.batchStatus')}</th>
                  <th className="inv-num">{t('inventory.mm.cat.stock.lines')}</th>
                  <th className="inv-num">{t('inventory.mm.cat.stock.pendingQty')}</th>
                </tr></thead>
                <tbody>
                  {pending.sites.map((s) => (
                    <tr key={s.site}>
                      <td><b>{s.site}</b>{s.country ? <small className="cc-card-sub"> {s.country}</small> : null}</td>
                      <td>{s.statuses.map((st) => t(`inventory.mm.cat.batchStatus.${st}`)).join(', ')}</td>
                      <td className="inv-num">{n(s.lines)}</td><td className="inv-num">{n(s.qty)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <th>{t('inventory.mm.total')}{pending.uom ? ` (${pending.uom})` : pending.mixedUom ? ` (${t('inventory.mm.cat.stock.mixedUom')})` : ''}</th>
                  <th /><th className="inv-num">{n(pending.lines)}</th><th className="inv-num">{n(pending.qty)}</th>
                </tr></tfoot>
              </table>
            </div>
          </>
        )}
    </div>
  )
}

function AvailabilityTab({ r, scope, t }) {
  if (r.browse) return <p className="cc-card-sub">{t('inventory.mm.loadingDetail')}</p>
  const store = storeAvailability(r)
  const cross = crossLocationStock(r)
  if (!store.rows.length) return <Note>{t('inventory.mm.cat.noVariantStock')}</Note>
  return (
    <div className="inv-hub" style={{ gap: 12 }}>
      <h3 className="inv-h3">{t('inventory.mm.byStore')}</h3>
      <div className="cc-et inv-scroll">
        <table>
          <thead><tr>
            <th>{t('inventory.locations.store')}</th><th className="inv-num">{t('inventory.mm.filter.genuine')}</th>
            <th className="inv-num">{t('inventory.mm.filter.aftermarket')}</th><th className="inv-num">{t('inventory.mm.total')}</th>
          </tr></thead>
          <tbody>
            {store.rows.map((s) => (
              <tr key={s.site}>
                <td><b>{s.site}</b>{scope.country ? <small className="cc-card-sub"> {scope.country}</small> : null}</td>
                <td className="inv-num">{n(s.genuine)}</td><td className="inv-num">{n(s.aftermarket)}</td><td className="inv-num">{n(s.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <th>{t('inventory.mm.sumTotal')}</th><th className="inv-num">{n(store.totals.genuine)}</th>
            <th className="inv-num">{n(store.totals.aftermarket)}</th><th className="inv-num">{n(store.totals.total)}</th>
          </tr></tfoot>
        </table>
      </div>
      {store.totals.other > 0 && <p className="cc-card-sub">{t('inventory.mm.otherNote', { n: n(store.totals.other) })}</p>}
      <h3 className="inv-h3">{t('inventory.mm.crossLocation')}</h3>
      <div className="cc-et inv-scroll">
        <table>
          <thead><tr>
            <th>{t('inventory.mm.location')}</th>
            {['available', 'reserved', 'in_transit', 'damaged', 'quarantined'].map((k) => <th key={k} className="inv-num">{t(`inventory.mm.qty.${k}`)}</th>)}
            <th className="inv-num">{t('inventory.mm.total')}</th>
          </tr></thead>
          <tbody>
            {cross.rows.map((s) => (
              <tr key={s.site}><td><b>{s.site}</b></td>
                {['available', 'reserved', 'in_transit', 'damaged', 'quarantined'].map((k) => <td key={k} className="inv-num">{n(s[k])}</td>)}
                <td className="inv-num">{n(s.total)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><th>{t('inventory.mm.total')}</th>
            {['available', 'reserved', 'in_transit', 'damaged', 'quarantined'].map((k) => <th key={k} className="inv-num">{n(cross.totals[k])}</th>)}
            <th className="inv-num">{n(cross.totals.total)}</th></tr></tfoot>
        </table>
      </div>
    </div>
  )
}

function ReferencesTab({ r, t }) {
  const refs = alternativeReferences(r)
  const all = r.references || []
  return (
    <div className="inv-hub" style={{ gap: 12 }}>
      <h3 className="inv-h3">{t('inventory.mm.altRefs')}</h3>
      {refs.length ? (
        <div className="inv-scroll">
          <KitTable compact rows={refs} columns={[
            { key: 'manufacturer', header: t('inventory.mm.f.manufacturer'), cell: (x) => na(x.manufacturer) },
            { key: 'partNumber', header: t('inventory.mm.f.partNumber'), cell: (x) => <><span className="inv-mono" dir="ltr">{x.partNumber}</span> <CopyButton value={x.partNumber} label={t('inventory.mm.f.partNumber')} t={t} /></> },
            { key: 'verified', header: t('inventory.pi.common.status'), cell: (x) => (x.verified
              ? <span className="inv-verified"><CheckCircle2 size={14} aria-hidden="true" /> {t('inventory.mm.verified')}</span>
              : <StatusPill value="unverified" tone="warn" label={t('inventory.mm.filter.unverified')} />) },
          ]} />
        </div>
      ) : <p className="cc-na">{t('inventory.mm.noAltRefs')}</p>}
      <h3 className="inv-h3">{t('inventory.mm.allRefs')}</h3>
      {all.length ? (
        <ul className="inv-pi-list">
          {all.map((x, i) => <li key={`${x.type}-${x.value}-${i}`}><span>{t(`inventory.mm.refType.${x.type}`)}</span><strong dir="ltr" className="inv-mono">{x.value}</strong></li>)}
        </ul>
      ) : <p className="cc-na">{t('inventory.mm.noRefs')}</p>}
    </div>
  )
}

function PhotosTab({ id, t }) {
  const q = useInvQuery(() => listPhotos({ canonicalId: id }), [id])
  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.loading && !q.data) return <div className="cc-skel" style={{ height: 90 }} />
  const rows = q.data || []
  if (!rows.length) return <p className="cc-na">{t('inventory.mm.noPhotos')}</p>
  return (
    <>
      <p className="cc-card-sub">{t('inventory.mm.photosCount', { n: rows.length })}</p>
      <div className="inv-mm-photos">
        {rows.map((p) => (
          <figure key={p.id}>
            {p.thumbUrl || p.url ? <img src={p.thumbUrl || p.url} alt={t(`inventory.pi.photoRole.${p.photo_role}`)} loading="lazy" /> : <span className="inv-mm-thumb"><ImageIcon size={22} aria-hidden="true" /></span>}
            <figcaption>{t(`inventory.pi.photoRole.${p.photo_role}`)}</figcaption>
          </figure>
        ))}
      </div>
    </>
  )
}

function HistoryTab({ id, t }) {
  const q = useInvQuery(() => getMaterial(id), [id])
  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  const m = q.data
  if (q.loading && !m) return <div className="cc-skel" style={{ height: 60 }} />
  if (!m) return <p className="cc-na">{t('inventory.mm.noHistory')}</p>
  return (
    <ul className="inv-pi-list">
      <li><span>{t('inventory.mm.h.proposed')}{m.proposed_from_site ? ` (${m.proposed_from_site})` : ''}</span><strong>{fmtDateTime(m.proposed_at)}</strong></li>
      <li><span>{t('inventory.mm.h.approved')}</span><strong>{fmtDateTime(m.approved_at)}</strong></li>
      <li><span>{t('inventory.mm.h.updated')}</span><strong>{fmtDateTime(m.updated_at)}</strong></li>
      {m.decision_note && <li><span>{t('inventory.mm.h.note')}</span><strong>{m.decision_note}</strong></li>}
    </ul>
  )
}

function CorrectionsTab({ r, userId, t, onCount }) {
  const ids = [r.canonical_id, ...(r.variants || []).map((v) => v.variant_id)].filter(Boolean)
  const [stamp, setStamp] = useState(0)
  const [open, setOpen] = useState(null)
  const q = useInvQuery(() => listCorrections({ status: 'all', pageSize: 50, targetIds: ids }), [ids.join(','), stamp])
  const pending = (q.data?.rows || []).filter((c) => c.status === 'submitted').length
  useEffect(() => { onCount?.(q.data?.status === 'ok' ? pending : null) }, [pending, q.data?.status, onCount])
  return (
    <>
      <CorrectionRows query={q} t={t} onReview={setOpen} empty={t('inventory.mm.noCorrections')} />
      {open && <CorrectionDetail row={open} userId={userId} t={t} onClose={() => setOpen(null)} onDone={() => { setOpen(null); setStamp((s) => s + 1) }} />}
    </>
  )
}

function Detail({ base, scope, userId, t }) {
  const [tab, setTab] = useState('availability')
  const [full, setFull] = useState(base.browse ? null : base)
  const [err, setErr] = useState('')
  const [pending, setPending] = useState(null)
  useEffect(() => {
    setTab('availability'); setErr(''); setPending(null)
    if (!base.browse) { setFull(base); return undefined }
    setFull(null)
    let live = true
    const q = base.company_sku || base.description || ''
    searchMaterials(q, { limit: 25 })
      .then((res) => { if (live) setFull((res.results || []).find((x) => x.canonical_id === base.canonical_id) || { ...base, browse: false }) })
      .catch((e) => { if (live) { setErr(toUserMessage(e)); setFull({ ...base, browse: false }) } })
    return () => { live = false }
  }, [base])
  const r = full || base
  const icons = { availability: Package, references: Link2, compatibility: Wrench, photos: ImageIcon, history: History, corrections: FileText, documents: FileText }

  return (
    <div className="inv-mm-detail">
      <div className="inv-mm-head">
        <span className="inv-mm-photo" aria-hidden="true"><Package size={40} /></span>
        <div style={{ minWidth: 0 }}>
          <h2>{na(r.description)}</h2>
          <div className="inv-mm-sku-line">
            <span className="cc-card-sub">{t('inventory.mm.f.companySku')}</span>
            <span className="inv-mono" dir="ltr">{r.company_sku || 'N/A'}</span>
            <CopyButton value={r.company_sku} label={t('inventory.mm.f.companySku')} t={t} />
            <StatusPill value={r.status} tone={r.status === 'active' ? 'good' : 'warn'} label={t(`inventory.mm.status.${r.status}`)} />
          </div>
          <Chips r={base} t={t} />
        </div>
      </div>
      {err && <ErrorNote error={err} />}
      <div className="inv-cols-2">
        <SectionCard title={t('inventory.mm.specs')}><Facts r={r} cat={base} t={t} /></SectionCard>
        <SectionCard title={t('inventory.mm.cat.stock.title')}><StockOnHand cat={base} t={t} /></SectionCard>
      </div>
      <SectionCard title={pending ? t('inventory.mm.correctionsPending', { n: pending }) : t('inventory.mm.corrections')}>
        <CorrectionsTab r={r} userId={userId} t={t} onCount={setPending} />
      </SectionCard>
      <div className="inv-toptabs inv-toptabs-sub" role="tablist" aria-label={t('inventory.mm.detailTabs')}>
        {DETAIL_TABS.filter((k) => k !== 'corrections').map((k) => {
          const Icon = icons[k]
          return (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className="inv-toptab" onClick={() => setTab(k)}>
              <Icon size={15} aria-hidden="true" /> <span>{t(`inventory.mm.tab.${k}`)}</span>
            </button>
          )
        })}
      </div>
      <div role="tabpanel">
        {tab === 'availability' && (full ? <AvailabilityTab r={r} scope={scope} t={t} /> : <div className="cc-skel" style={{ height: 120 }} />)}
        {tab === 'references' && <ReferencesTab r={r} t={t} />}
        {tab === 'compatibility' && <Note>{t('inventory.mm.noCompatibility')}</Note>}
        {tab === 'photos' && <PhotosTab id={r.canonical_id} t={t} />}
        {tab === 'history' && <HistoryTab id={r.canonical_id} t={t} />}
        {tab === 'documents' && <Note>{t('inventory.mm.noDocuments')}</Note>}
      </div>
    </div>
  )
}

const PAGE_SIZE = 25
const NO_FILTERS = { status: 'all', partType: 'all', brand: 'all', category: 'all', stock: 'all' }
const PART_LABELS = { variants: 'inventory.mm.cat.part.variants', aliases: 'inventory.mm.cat.part.oem', balances: 'inventory.mm.cat.part.stock', openingLines: 'inventory.mm.cat.part.pending' }

export default function MaterialMasterSection({ scope, userId, onNavigate, seedQuery = '' }) {
  const { t } = useLanguage()
  const [term, setTerm] = useState(seedQuery || '')
  const [query, setQuery] = useState(seedQuery || '')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState(null)
  const [scan, setScan] = useState(false)

  useEffect(() => { if (seedQuery) { setTerm(seedQuery); setQuery(seedQuery); setPage(0) } }, [seedQuery])

  const facetQ = useInvQuery(() => loadMaterialCatalogFacets(), [])
  const facets = useMemo(() => catalogFacets(facetQ.data?.rows), [facetQ.data])

  const list = useInvQuery(async () => {
    const q = query.trim()
    let matchIds
    if (q.length >= 2) {
      // Widen a text search to OEM / part numbers and aliases; a failed reference search only narrows the result.
      try {
        const res = await searchMaterials(q, { limit: 50 })
        matchIds = (res.results || []).map((x) => x.canonical_id)
      } catch { matchIds = undefined }
    }
    const res = await listMaterialCatalog({ ...filters, search: q, matchIds, page, pageSize })
    if (res.status !== 'ok') return { ...res, failed: [] }
    const detail = await loadMaterialCatalogDetail(res.rows)
    const failed = Object.keys(PART_LABELS).filter((k) => detail[k] === null)
    return { ...res, failed, rows: enrichMaterials(res.rows, detail).map(fromCatalog) }
  }, [query, filters, page, pageSize])

  const rows = useMemo(() => list.data?.rows || [], [list.data])
  useEffect(() => { setSelected((s) => (s && rows.find((r) => r.canonical_id === s.canonical_id)) || rows[0] || null) }, [rows])

  const setFilter = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(0) }
  const filtered = Object.entries(filters).some(([k, v]) => v !== NO_FILTERS[k])
  const submit = (e) => { e.preventDefault(); setQuery(term.trim()); setPage(0) }
  const clearAll = () => { setFilters(NO_FILTERS); setTerm(''); setQuery(''); setPage(0) }
  const total = list.data?.total ?? 0

  return (
    <div className="inv-hub">
      <form className="inv-mm-search" onSubmit={submit} role="search">
        <div className="inv-mm-input">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('inventory.mm.searchPh')} aria-label={t('inventory.mm.searchPh')} />
        </div>
        <button type="submit" className="inv-btn-accent"><Search size={15} aria-hidden="true" /> {t('inventory.mm.search')}</button>
        {codeScanSupported() && (
          <button type="button" className="inv-btn-outline" onClick={() => setScan(true)}><ScanLine size={15} aria-hidden="true" /> {t('inventory.mm.scan')}</button>
        )}
        <button type="button" className="inv-btn-accent" onClick={() => onNavigate('physical', 'materials')}>
          <Plus size={15} aria-hidden="true" /> {t('inventory.mm.propose')}
        </button>
      </form>

      <div className="inv-toolbar" role="group" aria-label={t('inventory.mm.filterLabel')}>
        <label className="cc-field">
          <span>{t('inventory.mm.cat.filter.status')}</span>
          <select className="cc-select" value={filters.status} onChange={setFilter('status')}>
            <option value="all">{t('inventory.mm.cat.filter.allStatuses')}</option>
            {MATERIAL_STATUSES.map((k) => <option key={k} value={k}>{t(`inventory.mm.status.${k}`)}</option>)}
          </select>
        </label>
        <label className="cc-field">
          <span>{t('inventory.mm.cat.partType')}</span>
          <select className="cc-select" value={filters.partType} onChange={setFilter('partType')}>
            {PART_TYPE_FILTERS.map((k) => <option key={k} value={k}>{k === 'all' ? t('inventory.mm.cat.filter.allTypes') : t(`inventory.mm.cat.type.${k}`)}</option>)}
          </select>
        </label>
        <label className="cc-field">
          <span>{t('inventory.mm.cat.brand')}</span>
          <select className="cc-select" value={filters.brand} onChange={setFilter('brand')} disabled={!facets.brands.length && filters.brand === 'all'}>
            <option value="all">{t('inventory.mm.cat.filter.allBrands')}</option>
            {facets.brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="cc-field">
          <span>{t('inventory.mm.f.category')}</span>
          <select className="cc-select" value={filters.category} onChange={setFilter('category')}>
            <option value="all">{t('inventory.mm.allCategories')}</option>
            {facets.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="cc-field">
          <span>{t('inventory.mm.cat.filter.stock')}</span>
          <select className="cc-select" value={filters.stock} onChange={setFilter('stock')}>
            {STOCK_FILTERS.map((k) => <option key={k} value={k}>{t(`inventory.mm.cat.filter.stockOpt.${k}`)}</option>)}
          </select>
        </label>
        {(filtered || query) && (
          <button type="button" className="cc-btn-ghost" onClick={clearAll}>{t('inventory.mm.cat.filter.clear')}</button>
        )}
      </div>
      {facetQ.error && <ErrorNote error={facetQ.error} onRetry={facetQ.retry} />}

      {list.data?.status === 'ok' && (
        <p className="cc-card-sub">{t('inventory.mm.cat.count', { n: n(total) })}{list.data.truncated ? ` ${t('inventory.mm.cat.truncated')}` : ''}</p>
      )}
      {list.data?.failed?.length > 0 && (
        <ErrorNote error={t('inventory.mm.cat.lookupFailed', { what: list.data.failed.map((k) => t(PART_LABELS[k])).join(', ') })} onRetry={list.retry} />
      )}

      {list.error ? <ErrorNote error={list.error} onRetry={list.retry} />
        : list.data?.status === 'not_provisioned' ? <NotSetUp what={t('inventory.ui.tabs.materials')} />
          : list.loading && !list.data ? <div className="cc-skel" style={{ height: 240 }} aria-busy="true" />
            : !rows.length ? (
              <div className="cc-empty">{query ? t('inventory.mm.noResults', { q: query }) : filtered ? t('inventory.mm.cat.noMatch') : t('inventory.mm.empty')}</div>
            ) : (
              <>
                <div className="inv-mm-grid" aria-busy={list.loading || undefined}>
                  <ul className="inv-mm-list" aria-label={t('inventory.mm.results')}>
                    {rows.map((r) => (
                      <li key={r.canonical_id}><ItemCard r={r} selected={selected?.canonical_id === r.canonical_id} onSelect={setSelected} t={t} /></li>
                    ))}
                  </ul>
                  {selected && <Detail base={selected} scope={scope} userId={userId} t={t} />}
                </div>
                {total > 0 && (
                  <Pager page={page} pageSize={pageSize} total={total} onPage={setPage}
                    onPageSize={(s) => { setPageSize(s); setPage(0) }} sizes={[25, 50, 100]} noun={t('inventory.mm.cat.pagerNoun')} />
                )}
              </>
            )}
      <OemCrossRefPanel scope={scope} userId={userId} />
      <OemFitmentPanel scope={scope} />
      {scan && <CodeScanCamera open={scan} t={t} onClose={() => setScan(false)} onCode={(code) => { setScan(false); setTerm(code); setQuery(code); setPage(0) }} />}
    </div>
  )
}
