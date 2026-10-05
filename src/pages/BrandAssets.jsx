/**
 * BrandAssets (route /brand-assets, Admin) - the living brand gallery, rebuilt
 * on the Command Center kit to the owner's mockup.
 *
 * Everything shown is real:
 *   - Logos: the shipped library (public/brand/library) plus the tenant's own
 *     marks (system_config company_logo, branding logo_url, uploaded
 *     placements). Illustrations and icons: the component registries.
 *   - Usage: the tenant placement map (organisations.settings branding logos).
 *     Reports / Email / Mobile / Web tabs filter by that usage.
 *   - Governance: placement consistency, broken placements, placements left on
 *     the default, deprecated assets still in use.
 *   - Owner and review status: brand_asset_registry (migration
 *     20261005150000). Before it is applied the page says so and the
 *     "Edit details" action is disabled; nothing is invented.
 *
 * Kept from the previous page: search, one-click copy of ids and snippets,
 * every logo, illustration and icon preview. Added: assign a library logo to a
 * placement (through the existing set_org_branding RPC), download, and an
 * Excel export of the catalogue.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  Image as ImageIcon, Shapes, Sparkles, Layers, AlertTriangle, Search, X, Copy, Check,
  Download, ChevronRight, FileSpreadsheet, RefreshCw, Pencil, Code2,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, Tabs, fmtInt } from '../components/commandCenter/kit'
import { Illustration, ILLUSTRATION_NAMES } from '../components/illustrations'
import { TpIcon, ICON_NAMES } from '../components/icons'
import { BRAND_LOGOS, LOGO_SLOTS, assetUrl } from '../lib/brand/library'
import { getOrgBranding, setOrgBranding } from '../lib/api/branding'
import { getCompanyLogo } from '../lib/api/brandLogo'
import { listBrandAssetMeta, saveBrandAssetMeta, REGISTRY_STATUSES } from '../lib/api/brandAssetRegistry'
import {
  ASSET_TABS, KIND_LABEL, buildCatalog, filterCatalog, tabCounts, governance, brokenPlacements, fmtBytes,
} from '../lib/brandAssetsView'
import { useTenant } from '../contexts/TenantContext'
import { exportToExcel, reportFileName } from '../lib/exportUtils'
import { safeHref, safeImageSrc } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'
import './BrandAssets.css'

const PAGE_STEP = 36
const STATUS_LABEL = { approved: 'Approved', draft: 'Draft', deprecated: 'Deprecated' }

function useCopy(timeout = 1400) {
  const [copied, setCopied] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const mark = useCallback((key) => {
    setCopied(key)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(null), timeout)
  }, [timeout])
  const copy = useCallback((value, key = value) => {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = value; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
        mark(key)
      } catch { /* copy unsupported, non-critical */ }
    }
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(value).then(() => mark(key), fallback)
    else fallback()
  }, [mark])
  return { copied, copy }
}

/** Loads branding, company logo and the registry, each on its own. */
function useBrandData() {
  const [state, setState] = useState({ loading: true, branding: null, brandingError: null, companyLogo: null, registry: null, registryError: null, provisioned: true })
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const [b, logo, reg] = await Promise.allSettled([getOrgBranding(null), getCompanyLogo(), listBrandAssetMeta()])
    setState({
      loading: false,
      branding: b.status === 'fulfilled' ? (b.value || {}) : null,
      brandingError: b.status === 'rejected' ? toUserMessage(b.reason, 'Could not read the tenant branding.') : null,
      companyLogo: logo.status === 'fulfilled' ? logo.value : null,
      registry: reg.status === 'fulfilled' ? reg.value.rows : null,
      provisioned: reg.status === 'fulfilled' ? reg.value.provisioned : true,
      registryError: reg.status === 'rejected' ? toUserMessage(reg.reason, 'Could not read the asset registry.') : null,
    })
  }, [])
  useEffect(() => { run() }, [run])
  return { ...state, retry: run }
}

function Preview({ asset, size = 'md' }) {
  const big = size === 'lg'
  if (asset.kind === 'logo') {
    const url = assetUrl(asset.id)
    return url ? <img src={url} alt={asset.name} loading="lazy" /> : <ImageIcon size={26} aria-hidden="true" />
  }
  if (asset.kind === 'tenant') {
    const src = safeImageSrc(asset.url)
    return src ? <img src={src} alt={asset.name} loading="lazy" /> : <ImageIcon size={26} aria-hidden="true" />
  }
  if (asset.kind === 'illustration') return <Illustration name={asset.id} size={big ? 200 : 96} title={asset.id} />
  return <TpIcon name={asset.id} size={big ? 64 : 30} />
}

export default function BrandAssets() {
  const data = useBrandData()
  const tenant = useTenant()
  const { copied, copy } = useCopy()
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE_STEP)
  const [selectedId, setSelectedId] = useState('emblem-green')
  const [notice, setNotice] = useState(null)
  const [assigning, setAssigning] = useState(false)
  const [slotPick, setSlotPick] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [meta, setMeta] = useState({ owner: '', status: 'approved', notes: '' })
  const [saving, setSaving] = useState(false)
  const [metaError, setMetaError] = useState('')

  const catalog = useMemo(() => buildCatalog({
    logos: BRAND_LOGOS, illustrations: ILLUSTRATION_NAMES, icons: ICON_NAMES,
    branding: data.branding, companyLogo: data.companyLogo, slots: LOGO_SLOTS,
  }), [data.branding, data.companyLogo])
  const counts = useMemo(() => tabCounts(catalog), [catalog])
  const filtered = useMemo(() => filterCatalog(catalog, tab, query), [catalog, tab, query])
  const gov = useMemo(() => governance({ branding: data.branding, logos: BRAND_LOGOS, slots: LOGO_SLOTS, companyLogo: data.companyLogo, registry: data.registry }), [data.branding, data.companyLogo, data.registry])
  const broken = useMemo(() => brokenPlacements(data.branding, BRAND_LOGOS, LOGO_SLOTS), [data.branding])
  const registryById = useMemo(() => new Map((data.registry || []).map((r) => [r.asset_id, r])), [data.registry])

  const selected = catalog.find((a) => a.id === selectedId) || filtered[0] || catalog[0]
  const selMeta = selected ? registryById.get(selected.id) : null
  const tenantCount = catalog.filter((a) => a.kind === 'tenant').length

  useEffect(() => { setShown(PAGE_STEP) }, [tab, query])

  const brandingKnown = !!data.branding
  const kpiLoading = data.loading && !data.branding && !data.brandingError

  const assignPlacement = async () => {
    if (!selected || selected.kind !== 'logo' || !slotPick) return
    const orgId = data.branding?.org_id ?? tenant?.orgId ?? null
    if (!orgId) { setNotice({ tone: 'bad', text: 'Your account is not linked to a company, so placements cannot be saved.' }); return }
    setAssigning(true); setNotice(null)
    try {
      const logos = { ...(data.branding?.logos || {}), [slotPick]: selected.id }
      await setOrgBranding(orgId, { logos })
      const slot = LOGO_SLOTS.find((s) => s.key === slotPick)
      setNotice({ tone: 'good', text: `${selected.name} is now used for ${slot?.label || slotPick}.` })
      setSlotPick('')
      await data.retry()
      tenant?.refreshBranding?.()
    } catch (e) {
      setNotice({ tone: 'bad', text: toUserMessage(e, 'Could not save the placement.') })
    } finally {
      setAssigning(false)
    }
  }

  const openEdit = () => {
    setMeta({ owner: selMeta?.owner || '', status: selMeta?.status || 'approved', notes: selMeta?.notes || '' })
    setMetaError(''); setEditOpen(true)
  }
  const saveMeta = async (e) => {
    e?.preventDefault?.()
    setSaving(true); setMetaError('')
    try {
      await saveBrandAssetMeta({ asset_id: selected.id, asset_kind: selected.kind, ...meta })
      setEditOpen(false)
      await data.retry()
      setNotice({ tone: 'good', text: `Details saved for ${selected.name}.` })
    } catch (err) {
      setMetaError(toUserMessage(err, 'Could not save the asset details.'))
    } finally {
      setSaving(false)
    }
  }

  const exportCatalog = () => {
    const rows = filtered.map((a) => ({
      id: a.id, name: a.name, kind: KIND_LABEL[a.kind], category: a.category, format: a.format,
      size: a.width ? `${a.width} x ${a.height}` : '', bytes: fmtBytes(a.bytes) || '',
      used_in: a.usage.map((u) => u.label).join('; '),
      status: STATUS_LABEL[registryById.get(a.id)?.status] || 'Not reviewed',
      owner: registryById.get(a.id)?.owner || '',
    }))
    const cols = ['id', 'name', 'kind', 'category', 'format', 'size', 'bytes', 'used_in', 'status', 'owner']
    const headers = ['Asset ID', 'Name', 'Type', 'Category', 'Format', 'Dimensions', 'File size', 'Used in', 'Review status', 'Owner']
    exportToExcel(rows, cols, headers, reportFileName('Brand Assets'))
  }

  const downloadHref = selected
    ? (selected.kind === 'logo' ? assetUrl(selected.id) : selected.kind === 'tenant' ? safeHref(selected.url) : null)
    : null

  return (
    <div className="cc ba-page">
      <header className="ba-head">
        <div className="ba-head-copy">
          <nav aria-label="Breadcrumb" className="ba-crumb">Administration <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">Brand Assets</span></nav>
          <h1>Brand Assets</h1>
          <p>Every logo, illustration and icon the product ships with, plus your company&apos;s own marks and where each one is used.</p>
        </div>
        <div className="ba-head-actions">
          <button type="button" className="cc-btn-ghost" onClick={data.retry} disabled={data.loading} aria-label="Refresh">
            <RefreshCw size={14} className={data.loading ? 'ba-spin' : undefined} aria-hidden="true" /> Refresh
          </button>
          <button type="button" className="cc-btn-primary" onClick={exportCatalog} disabled={!filtered.length}>
            <FileSpreadsheet size={15} aria-hidden="true" /> Export catalogue
          </button>
        </div>
      </header>

      {notice && (
        <div className={`cc-card ba-banner ${notice.tone}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button type="button" className="cc-icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {data.brandingError && (
        <div className="cc-card ba-banner bad" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{data.brandingError} Usage and governance figures need it, so they show N/A.</span>
          <button type="button" className="cc-btn" onClick={data.retry}>Try again</button>
        </div>
      )}

      <div className="cc-kpis ba-kpis">
        <Kpi icon={ImageIcon} tone="t-green" value={counts.logo + tenantCount} loading={kpiLoading}
          label={`Logo assets, ${BRAND_LOGOS.length} library and ${tenantCount} tenant`} onClick={() => setTab('logo')} />
        <Kpi icon={Shapes} tone="t-blue" value={ILLUSTRATION_NAMES.length} label="Illustrations, product and empty states" onClick={() => setTab('illustration')} />
        <Kpi icon={Sparkles} tone="t-purple" value={ICON_NAMES.length} label="Icons, navigation and actions" onClick={() => setTab('icon')} />
        <Kpi icon={Layers} tone="t-amber" loading={kpiLoading}
          display={brandingKnown ? `${gov.assigned} / ${gov.slotTotal}` : 'N/A'}
          label="Tenant placements set" title="Logo placements (app, login, favicon, report, email, mobile, watermark) pointing at a real mark" />
        <Kpi icon={AlertTriangle} tone="t-red" loading={kpiLoading}
          display={gov.warnings == null ? 'N/A' : fmtInt(gov.warnings)} danger={gov.warnings > 0}
          label="Usage warnings, broken, missing or deprecated" />
      </div>

      <Tabs
        label="Asset type and usage"
        tabs={ASSET_TABS.map((t) => ({ ...t, count: counts[t.key] }))}
        value={tab}
        onChange={setTab}
      />

      <div className="ba-grid">
        <section className="cc-card ba-gallery" aria-label="Asset gallery">
          <div className="cc-card-head">
            <div>
              <h2 className="cc-card-title">Asset gallery</h2>
              <p className="cc-card-sub">{filtered.length} of {catalog.length} assets</p>
            </div>
            <label className="cc-search ba-search">
              <Search size={15} aria-hidden="true" />
              <input placeholder="Search by id, name, colour" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search assets" />
            </label>
          </div>
          {filtered.length === 0 ? (
            <div className="cc-empty">
              {query ? `Nothing matches "${query}".`
                : ['reports', 'email', 'mobile', 'web'].includes(tab)
                  ? (brandingKnown ? 'No asset is placed on this channel yet. Pick a logo and assign it to a placement.' : 'Usage could not be read.')
                  : 'No assets in this group.'}
            </div>
          ) : (
            <>
              <ul className="ba-cards">
                {filtered.slice(0, shown).map((a) => {
                  const st = registryById.get(a.id)?.status
                  return (
                    <li key={a.id}>
                      <div className={`ba-card ${selected?.id === a.id ? 'on' : ''}`}>
                        <button type="button" className="ba-card-main" onClick={() => setSelectedId(a.id)} aria-pressed={selected?.id === a.id} aria-label={`Select ${a.name}`}>
                          <span className={`ba-thumb ba-thumb-${a.kind}`}><Preview asset={a} /></span>
                          <span className="ba-card-text">
                            <span className="ba-card-name">{a.name}</span>
                            <code className="ba-card-id">{a.id}</code>
                            <span className="ba-card-tags">
                              <span className={`ba-kind k-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                              {a.usage.length > 0 && <span className="ba-used">In use {a.usage.length}</span>}
                              {st === 'deprecated' && <span className="ba-dep">Deprecated</span>}
                            </span>
                          </span>
                        </button>
                        <button type="button" className="ba-copy" onClick={() => copy(a.snippet || a.id, a.id)} aria-label={`Copy ${a.snippet ? 'snippet' : 'id'} for ${a.name}`}>
                          {copied === a.id ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                          {copied === a.id ? 'Copied' : a.snippet ? 'Copy snippet' : 'Copy ID'}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {filtered.length > shown && (
                <div className="ba-more">
                  <button type="button" className="cc-btn-ghost" onClick={() => setShown((n) => n + PAGE_STEP)}>
                    Show {Math.min(PAGE_STEP, filtered.length - shown)} more of {filtered.length - shown}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <Card title="Selected asset" className="ba-selected">
          {!selected ? <div className="cc-empty">Pick an asset to see its details.</div> : (
            <>
              <div className={`ba-hero ba-hero-${selected.kind}`}><Preview asset={selected} size="lg" /></div>
              <h3 className="ba-sel-name">{selected.name}</h3>
              <code className="ba-sel-id">{selected.id}</code>
              <dl className="ba-facts">
                <dt>Type</dt><dd>{KIND_LABEL[selected.kind]}</dd>
                <dt>Format</dt><dd>{selected.format}</dd>
                {selected.width != null && <><dt>Dimensions</dt><dd>{selected.width} x {selected.height} px{fmtBytes(selected.bytes) ? `, ${fmtBytes(selected.bytes)}` : ''}</dd></>}
                <dt>Category</dt><dd>{selected.category}{selected.color ? `, ${selected.color}` : ''}</dd>
                <dt>Source</dt><dd>{selected.source}</dd>
                <dt>Used in</dt>
                <dd>{!brandingKnown && selected.kind !== 'tenant' ? <span className="cc-na">Could not read placements</span>
                  : selected.usage.length ? selected.usage.map((u) => u.label).join(', ')
                    : <span className="cc-na">{selected.kind === 'logo' ? 'Not placed' : 'Used in code, not a placement'}</span>}</dd>
                <dt>Owner</dt>
                <dd>{!data.provisioned ? <span className="cc-na">Registry not set up</span> : selMeta?.owner || <span className="cc-na">Not recorded</span>}</dd>
                <dt>Status</dt>
                <dd>{!data.provisioned ? <span className="cc-na">Registry not set up</span>
                  : selMeta ? <span className={`cc-pill ba-st-${selMeta.status}`}>{STATUS_LABEL[selMeta.status]}</span>
                    : <span className="cc-na">Not reviewed</span>}</dd>
              </dl>
              {selMeta?.notes && <p className="ba-notes">{selMeta.notes}</p>}
              <div className="ba-sel-actions">
                <button type="button" className="cc-btn-primary" onClick={() => copy(selected.id, `sel:${selected.id}`)}>
                  {copied === `sel:${selected.id}` ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied === `sel:${selected.id}` ? 'Copied' : 'Copy asset ID'}
                </button>
                {selected.snippet && (
                  <button type="button" className="cc-btn-ghost" onClick={() => copy(selected.snippet, `snip:${selected.id}`)}>
                    <Code2 size={14} aria-hidden="true" /> {copied === `snip:${selected.id}` ? 'Copied' : 'Copy snippet'}
                  </button>
                )}
                {downloadHref && (
                  <a className="cc-btn-ghost" href={downloadHref} download target="_blank" rel="noopener noreferrer">
                    <Download size={14} aria-hidden="true" /> Download
                  </a>
                )}
                <button type="button" className="cc-btn-ghost" onClick={openEdit} disabled={!data.provisioned || !!data.registryError}
                  title={!data.provisioned ? 'The brand asset registry is not set up on this database yet' : undefined}>
                  <Pencil size={14} aria-hidden="true" /> Edit details
                </button>
              </div>
              {selected.kind === 'logo' && brandingKnown && (
                <div className="ba-assign">
                  <label htmlFor="ba-slot">Use this logo for</label>
                  <div className="ba-assign-row">
                    <select id="ba-slot" className="cc-select" value={slotPick} onChange={(e) => setSlotPick(e.target.value)}>
                      <option value="">Pick a placement</option>
                      {LOGO_SLOTS.map((s) => <option key={s.key} value={s.key}>{s.label}{s.recommend?.includes(BRAND_LOGOS.find((l) => l.id === selected.id)?.layout) ? ' (suits this layout)' : ''}</option>)}
                    </select>
                    <button type="button" className="cc-btn" onClick={assignPlacement} disabled={!slotPick || assigning}>{assigning ? 'Saving...' : 'Assign'}</button>
                  </div>
                  {slotPick && <p className="ba-hint">{LOGO_SLOTS.find((s) => s.key === slotPick)?.hint}</p>}
                </div>
              )}
              {!data.provisioned && (
                <p className="ba-hint">Owner and review status need the brand asset registry, which is not set up on this database yet.</p>
              )}
              {data.registryError && <p className="ba-hint ba-err" role="alert">{data.registryError}</p>}
            </>
          )}
        </Card>
      </div>

      <Card title="Brand governance" sub="How consistently your company marks are placed">
        <CardState state={{ loading: data.loading && !data.branding && !data.brandingError, error: data.brandingError, retry: data.retry }} lines={2}>
          <div className="ba-gov">
            <div className="ba-gov-tile">
              <span>Placement consistency</span>
              <b>{gov.consistencyPct == null ? 'N/A' : `${gov.consistencyPct}%`}</b>
              <small>{gov.consistencyPct == null ? 'No placement is set yet' : 'Placements using the most common mark'}</small>
            </div>
            <div className="ba-gov-tile">
              <span>Deprecated assets in use</span>
              <b className={gov.deprecatedInUse > 0 ? 'bad' : undefined}>{gov.deprecatedInUse == null ? 'N/A' : fmtInt(gov.deprecatedInUse)}</b>
              <small>{gov.deprecatedInUse == null ? 'Needs the asset registry' : 'Placements pointing at a deprecated asset'}</small>
            </div>
            <div className="ba-gov-tile">
              <span>Broken placements</span>
              <b className={gov.broken > 0 ? 'bad' : undefined}>{fmtInt(gov.broken)}</b>
              <small>{broken.length ? broken.map((b) => b.label).join(', ') : 'Every placement resolves'}</small>
            </div>
            <div className="ba-gov-tile">
              <span>Placements on the default</span>
              <b>{gov.unassigned == null ? 'N/A' : `${gov.unassigned} / ${gov.slotTotal}`}</b>
              <small>Fall back to the built-in Tyre Pulse mark</small>
            </div>
            <div className="ba-gov-tile">
              <span>Company logo for shared reports</span>
              <b className={data.companyLogo ? undefined : 'warn'}>{data.companyLogo ? 'Set' : 'Not set'}</b>
              <small>{data.companyLogo ? 'Shown on shared report links and TV boards' : 'Shared reports show the default mark'}</small>
            </div>
          </div>
        </CardState>
      </Card>

      <Modal
        open={editOpen}
        onClose={saving ? undefined : () => setEditOpen(false)}
        title={selected ? `Details for ${selected.name}` : 'Asset details'}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn-secondary text-sm" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</button>
            <button type="submit" form="ba-meta-form" className="btn-primary text-sm" disabled={saving}>{saving ? 'Saving...' : 'Save details'}</button>
          </>
        )}
      >
        <form id="ba-meta-form" onSubmit={saveMeta} className="space-y-4">
          <div>
            <label htmlFor="ba-owner" className="label">Owner (optional)</label>
            <input id="ba-owner" className="input w-full" placeholder="e.g. Marketing" maxLength={200} value={meta.owner} onChange={(e) => setMeta((m) => ({ ...m, owner: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="ba-status" className="label">Review status</label>
            <select id="ba-status" className="input w-full" value={meta.status} onChange={(e) => setMeta((m) => ({ ...m, status: e.target.value }))}>
              {REGISTRY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ba-notes" className="label">Notes (optional)</label>
            <textarea id="ba-notes" className="input w-full min-h-[70px] resize-y" maxLength={4000} value={meta.notes} onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))} />
          </div>
          {metaError && <p className="text-sm text-red-400" role="alert">{metaError}</p>}
        </form>
      </Modal>
    </div>
  )
}
