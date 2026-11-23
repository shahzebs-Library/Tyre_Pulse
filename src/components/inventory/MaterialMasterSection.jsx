/**
 * Material Master: one company material, every way it is identified (company
 * SKU, OEM part number, manufacturer / aftermarket part numbers), where it is
 * stocked and what is waiting for correction.
 *
 * Reads only: inv_material_search (company-wide, RLS decides which stores the
 * caller sees), material_canonical, physical_inventory_photos and
 * material_correction_requests. Proposing a material and deciding a
 * correction use the existing flows and RPCs; nothing is written here
 * directly. Unknown values print N/A.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Search, ScanLine, Plus, Copy, Check, Package, CheckCircle2, Image as ImageIcon, FileText, Link2, History, Wrench,
} from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { searchMaterials, listMaterials, getMaterial, listPhotos, listCorrections } from '../../lib/api/physicalInventory'
import {
  MM_FILTERS, filterCounts, categoriesOf, applyMaterialFilter, classifyMaterial, oemPartNumber, manufacturerPartNumber,
  alternativeReferences, storeAvailability, crossLocationStock, referenceOf,
} from '../../lib/inventory/materialMasterView'
import { toUserMessage } from '../../lib/inventory/errorText'
import CodeScanCamera, { codeScanSupported } from './CodeScanCamera'
import { CorrectionRows, CorrectionDetail } from './PhysicalInventoryReview'
import { KitTable } from '../commandCenter/kit'
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

/** A browse row (material_canonical) in the same shape as a search result. */
const fromCanonical = (m) => ({
  canonical_id: m.id, company_sku: m.company_sku, description: m.description, category: m.category, base_uom: m.base_uom,
  manufacturer: m.manufacturer, brand: m.brand, status: m.status, references: [], variants: [], availability_unassigned: [],
  browse: true,
})

function Chips({ r, t }) {
  const c = classifyMaterial(r)
  return (
    <span className="inv-mm-chips">
      {c.genuine && <span className="inv-chip inv-chip-accent inv-chip-oem">{t('inventory.mm.filter.genuine')}</span>}
      {c.aftermarket && <span className="inv-chip inv-chip-accent inv-chip-am">{t('inventory.mm.filter.aftermarket')}</span>}
      {!r.browse && c.unverified && <span className="inv-chip">{t('inventory.mm.filter.unverified')}</span>}
      {r.category && <span className="inv-chip">{r.category}</span>}
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
        <Chips r={r} t={t} />
      </span>
    </button>
  )
}

function Facts({ r, t }) {
  const oem = oemPartNumber(r)
  const mpn = manufacturerPartNumber(r)
  const rows = [
    [t('inventory.mm.f.companySku'), r.company_sku, true],
    [t('inventory.mm.f.oem'), oem, true],
    [t('inventory.mm.f.mpn'), mpn, true],
    [t('inventory.mm.f.brand'), [r.manufacturer, r.brand].filter(Boolean).join(' / ') || null],
    [t('inventory.mm.f.uom'), r.base_uom],
    [t('inventory.mm.f.category'), r.category],
    [t('inventory.mm.f.barcode'), referenceOf(r, 'barcode'), true],
    [t('inventory.mm.f.erp'), (r.erp_skus || []).map((e) => `${e.item_code}${e.country ? ` (${e.country})` : ''}`).join(', ') || null, false, true],
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

function AvailabilityTab({ r, scope, t }) {
  if (r.browse) return <p className="cc-card-sub">{t('inventory.mm.loadingDetail')}</p>
  const store = storeAvailability(r)
  const cross = crossLocationStock(r)
  if (!store.rows.length) return <Note>{t('inventory.mm.noStock')}</Note>
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
          <Chips r={r} t={t} />
        </div>
      </div>
      {err && <ErrorNote error={err} />}
      <div className="inv-cols-2">
        <SectionCard title={t('inventory.mm.specs')}><Facts r={r} t={t} /></SectionCard>
        <SectionCard title={pending ? t('inventory.mm.correctionsPending', { n: pending }) : t('inventory.mm.corrections')}>
          <CorrectionsTab r={r} userId={userId} t={t} onCount={setPending} />
        </SectionCard>
      </div>
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

export default function MaterialMasterSection({ scope, userId, onNavigate, seedQuery = '' }) {
  const { t } = useLanguage()
  const [term, setTerm] = useState(seedQuery || '')
  const [query, setQuery] = useState(seedQuery || '')
  const [filter, setFilter] = useState('all')
  const [category, setCategory] = useState('all')
  const [selected, setSelected] = useState(null)
  const [scan, setScan] = useState(false)

  useEffect(() => { if (seedQuery) { setTerm(seedQuery); setQuery(seedQuery) } }, [seedQuery])

  const search = useInvQuery(async () => {
    if (query.trim().length >= 2) {
      const res = await searchMaterials(query, { limit: 50 })
      return { status: res.status, mode: 'search', rows: res.results }
    }
    const res = await listMaterials({ status: 'all', pageSize: 48 })
    return { status: res.status, mode: 'browse', rows: (res.rows || []).map(fromCanonical), total: res.total }
  }, [query])

  const rows = useMemo(() => search.data?.rows || [], [search.data])
  const counts = useMemo(() => filterCounts(rows), [rows])
  const cats = useMemo(() => categoriesOf(rows), [rows])
  const shown = useMemo(() => applyMaterialFilter(rows, search.data?.mode === 'browse' ? 'all' : filter, category), [rows, filter, category, search.data?.mode])
  useEffect(() => { setSelected((s) => (s && rows.some((r) => r.canonical_id === s.canonical_id) ? s : rows[0] || null)) }, [rows])

  const submit = (e) => { e.preventDefault(); setQuery(term.trim()); setFilter('all'); setCategory('all') }

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

      <div className="inv-mm-filters">
        <div className="inv-mm-chipset" role="group" aria-label={t('inventory.mm.filterLabel')}>
          {MM_FILTERS.map((k) => {
            const disabled = search.data?.mode === 'browse' && k !== 'all'
            return (
              <button key={k} type="button" className="inv-filter-chip" aria-pressed={filter === k} disabled={disabled} onClick={() => setFilter(k)}>
                {t(`inventory.mm.filter.${k}`)} ({disabled ? 'N/A' : counts[k]})
              </button>
            )
          })}
        </div>
        <select className="cc-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('inventory.mm.f.category')}>
          <option value="all">{t('inventory.mm.allCategories')}</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {search.data?.mode === 'browse' && <p className="cc-card-sub">{t('inventory.mm.browseNote', { n: search.data.total ?? rows.length })}</p>}

      {search.error ? <ErrorNote error={search.error} onRetry={search.retry} />
        : search.data?.status === 'not_provisioned' ? <NotSetUp what={t('inventory.ui.tabs.materials')} />
          : search.loading && !search.data ? <div className="cc-skel" style={{ height: 240 }} aria-busy="true" />
            : !shown.length ? (
              <div className="cc-empty">{query ? t('inventory.mm.noResults', { q: query }) : t('inventory.mm.empty')}</div>
            ) : (
              <div className="inv-mm-grid">
                <ul className="inv-mm-list" aria-label={t('inventory.mm.results')}>
                  {shown.map((r) => (
                    <li key={r.canonical_id}><ItemCard r={r} selected={selected?.canonical_id === r.canonical_id} onSelect={setSelected} t={t} /></li>
                  ))}
                </ul>
                {selected && <Detail base={selected} scope={scope} userId={userId} t={t} />}
              </div>
            )}
      {scan && <CodeScanCamera open={scan} t={t} onClose={() => setScan(false)} onCode={(code) => { setScan(false); setTerm(code); setQuery(code) }} />}
    </div>
  )
}
