/**
 * Locations: the store -> warehouse -> zone -> rack/shelf -> bin hierarchy,
 * plus custody locations (in transit, quarantine, scrap, supplier, vehicle).
 *
 * Stores are the existing `sites` register and are only ever PICKED here,
 * never created. One location is added through the form (with a parent
 * picker); a whole rack / shelf / bin layout through Bulk setup, which shows a
 * preview before anything is saved. Each location prints a QR label carrying
 * `TP:LOC:<id>`, which the phone count screens scan to open the right bin.
 *
 * Writes are Admin / Manager / Director only, enforced by inv_location_upsert
 * and inv_location_bulk_create on the server; the gate here only hides buttons.
 */
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Plus, Pencil, Printer, FileDown, MapPin, Layers } from 'lucide-react'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { listLocations, saveLocation, newIdempotencyKey } from '../../lib/api/inventory'
import { listSites } from '../../lib/api/sites'
import {
  buildTree, flattenTree, filterTree, labelCode, validateLocationDraft, LOCATION_TYPES, NON_AVAILABLE_TYPES,
} from '../../lib/inventory/locationTree'
import { suggestChildType, canManageLocations } from '../../lib/inventory/locationBulk'
import { labelGrid, LABEL_SIZES, DEFAULT_SIZE } from '../../lib/qrLabelLayout'
import { loadPdf } from '../../lib/pdfEngine'
import { reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/inventory/errorText'
import { useInvQuery, ErrorNote, NotSetUp, Note, Field, SearchBox, SectionCard, StatusPill } from './InvUi'
import LocationBulkSetup from './LocationBulkSetup'

const EMPTY = { id: null, code: '', name: '', location_type: 'warehouse', parent_id: '', site: '', country: '', responsible_user_id: '', active: true }
const FONT = { sm: [7, 5], md: [9, 6.5], lg: [10.5, 7.5] }

function LocationForm({ draft, setDraft, errors, rows, stores, t }) {
  const editing = !!draft.id
  const parents = rows.filter((r) => r.id !== draft.id && draft.site && r.site === String(draft.site).toUpperCase())
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setDraft((d) => {
      const next = { ...d, [k]: v }
      if (k === 'site') {
        next.country = stores.find((s) => s.name === v)?.country || ''
        next.parent_id = ''
      }
      if (k === 'parent_id' && !editing) {
        const p = rows.find((r) => r.id === v)
        next.location_type = p ? suggestChildType(p.location_type) : 'warehouse'
      }
      return next
    })
  }
  const err = (k) => (errors[k] ? t(errors[k]) : null)
  const siteKnown = stores.some((s) => s.name === draft.site)
  return (
    <div className="inv-form">
      <Field label={t('inventory.locations.store')} error={err('site')} full>
        <select className="cc-select" value={draft.site} onChange={set('site')} disabled={editing}>
          <option value="">{t('inventory.common.choose')}</option>
          {editing && !siteKnown && draft.site && <option value={draft.site}>{draft.site}</option>}
          {stores.map((s) => <option key={`${s.country}:${s.name}`} value={s.name}>{s.name}{s.country ? ` (${s.country})` : ''}</option>)}
        </select>
      </Field>
      <Field label={t('inventory.locations.parent')} error={err('parent_id')} full>
        <select className="cc-select" value={draft.parent_id || ''} onChange={set('parent_id')} disabled={!draft.site}>
          <option value="">{t('inventory.locations.noParent')}</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.path || p.code} ({t(`inventory.locationTypes.${p.location_type}`)})</option>)}
        </select>
      </Field>
      <Field label={t('inventory.locations.type')} error={err('location_type')}>
        <select className="cc-select" value={draft.location_type} onChange={set('location_type')}>
          {LOCATION_TYPES.map((ty) => <option key={ty} value={ty}>{t(`inventory.locationTypes.${ty}`)}</option>)}
        </select>
      </Field>
      <Field label={t('inventory.locations.code')} error={err('code')}>
        <input className="inv-input" value={draft.code} onChange={set('code')} maxLength={40} autoComplete="off" disabled={editing} />
      </Field>
      <Field label={t('inventory.locations.name')} error={err('name')} full>
        <input className="inv-input" value={draft.name} onChange={set('name')} maxLength={120} />
      </Field>
      <label className="inv-check inv-full">
        <input type="checkbox" checked={draft.active !== false} onChange={set('active')} /> {t('inventory.locations.active')}
      </label>
    </div>
  )
}

async function qrFor(id) {
  return QRCode.toDataURL(labelCode(id), { width: 300, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
}

export default function LocationsSection({ scope }) {
  const { t } = useLanguage()
  const { profile, isSuperAdmin } = useAuth()
  const q = useInvQuery(() => listLocations(scope), [scope.country, scope.site])
  const [stores, setStores] = useState([])
  const [storesErr, setStoresErr] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [created, setCreated] = useState(null)
  const [errors, setErrors] = useState({})
  const [saveErr, setSaveErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [labels, setLabels] = useState(null)
  const [labelSize, setLabelSize] = useState(DEFAULT_SIZE)
  const [labelErr, setLabelErr] = useState('')
  const canManage = canManageLocations({ role: profile?.role, isSuperAdmin })

  useEffect(() => {
    let live = true
    setStoresErr('')
    listSites({ country: scope.country, activeOnly: true })
      .then((r) => { if (live) setStores(r.filter((s) => s.name).map((s) => ({ name: s.name, country: s.country }))) })
      .catch((e) => { if (live) { setStores([]); setStoresErr(toUserMessage(e)) } })
    return () => { live = false }
  }, [scope.country])

  const rows = useMemo(() => q.data?.rows || [], [q.data])
  const flatAll = useMemo(() => flattenTree(buildTree(rows)), [rows])
  const tree = useMemo(() => filterTree(buildTree(rows), search), [rows, search])
  const flat = useMemo(() => flattenTree(tree), [tree])
  const defaultSite = scope.site !== 'all'
    ? (stores.find((s) => s.name.toUpperCase() === String(scope.site).toUpperCase())?.name || '') : ''

  const open = (row) => {
    setErrors({}); setSaveErr('')
    const base = row
      ? { ...EMPTY, ...row, parent_id: row.parent_id || '' }
      : { ...EMPTY, site: defaultSite, country: stores.find((s) => s.name === defaultSite)?.country || '' }
    setEditing({ draft: base, key: newIdempotencyKey() })
  }

  const submit = async () => {
    const v = validateLocationDraft({ ...editing.draft, site: String(editing.draft.site || '').toUpperCase() }, rows)
    setErrors(v.errors)
    if (!v.ok) return
    setBusy(true); setSaveErr('')
    try {
      await saveLocation({ ...editing.draft, country: editing.draft.country || scope.country }, editing.key)
      setEditing(null)
      q.retry()
    } catch (err) {
      setSaveErr(toUserMessage(err))
    } finally { setBusy(false) }
  }

  const onBulkCreated = (result, codes) => {
    setBulkOpen(false)
    setCreated({ created: result?.created ?? 0, existing: result?.existing ?? 0, codes: new Set(codes.map((c) => String(c).toUpperCase())) })
    q.retry()
  }
  const createdNodes = created ? flatAll.filter((n) => created.codes.has(String(n.code).toUpperCase())) : []

  const buildLabels = async (list) => {
    setLabelErr('')
    try {
      const items = await Promise.all(list.map(async (n) => ({ id: n.id, code: n.code, name: n.name, path: n.path, site: n.site, img: await qrFor(n.id) })))
      setLabels(items)
    } catch (err) { setLabelErr(toUserMessage(err)) }
  }

  const downloadPdf = async () => {
    try {
      const { jsPDF } = await loadPdf()
      const grid = labelGrid(labelSize)
      const [big, small] = FONT[grid.key] || FONT.md
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      labels.forEach((l, i) => {
        const pos = i % grid.perPage
        if (i > 0 && pos === 0) doc.addPage()
        const col = pos % grid.cols
        const row = Math.floor(pos / grid.cols)
        const x = grid.marginX + col * (grid.w + grid.gap)
        const y = grid.marginY + row * (grid.h + grid.gap)
        doc.setDrawColor(180); doc.rect(x, y, grid.w, grid.h)
        const qr = grid.w - 14
        doc.addImage(l.img, 'PNG', x + 7, y + 1.5, qr, qr)
        doc.setFontSize(big); doc.text(String(l.code), x + grid.w / 2, y + qr + 4.5, { align: 'center', maxWidth: grid.w - 4 })
        doc.setFontSize(small); doc.text(String(l.site || ''), x + grid.w / 2, y + qr + 7.5, { align: 'center', maxWidth: grid.w - 4 })
      })
      doc.save(`${reportFileName('Location labels', scope.site !== 'all' ? scope.site : '')}.pdf`)
    } catch (err) { setLabelErr(toUserMessage(err)) }
  }

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.objects.inventory_locations')} />

  return (
    <div className="inv-hub">
      <div className="cc-filters">
        <SearchBox value={search} onChange={setSearch} placeholder={t('inventory.locations.search')} />
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" disabled={!flat.length} onClick={() => buildLabels(flat)}>
            <Printer size={14} aria-hidden="true" /> {t('inventory.locations.labels', { n: flat.length })}
          </button>
          {canManage && (
            <>
              <button type="button" className="cc-btn-ghost" disabled={!stores.length} onClick={() => setBulkOpen(true)}>
                <Layers size={14} aria-hidden="true" /> {t('inventory.locations.bulk.open')}
              </button>
              <button type="button" className="cc-btn-primary" disabled={!stores.length} onClick={() => open(null)}>
                <Plus size={14} aria-hidden="true" /> {t('inventory.locations.add')}
              </button>
            </>
          )}
        </div>
      </div>
      {q.data?.truncated && <Note tone="warn">{t('inventory.state.truncated')}</Note>}
      {!canManage && <Note>{t('inventory.locations.readOnly')}</Note>}
      {storesErr && <ErrorNote error={storesErr} />}
      {canManage && !storesErr && !stores.length && <Note tone="warn">{t('inventory.locations.noStores')}</Note>}
      {created && (
        <Note action={createdNodes.length > 0 && (
          <button type="button" className="cc-btn-ghost" onClick={() => buildLabels(createdNodes)}>
            <Printer size={14} aria-hidden="true" /> {t('inventory.locations.bulk.printNew', { n: createdNodes.length })}
          </button>
        )}>
          {t('inventory.locations.bulk.done', { created: created.created, existing: created.existing })}
        </Note>
      )}

      <SectionCard title={t('inventory.locations.title')} sub={t('inventory.locations.sub', { n: rows.length })}>
        {q.loading && !q.data ? <div className="cc-skel" style={{ height: 120 }} /> : flat.length === 0 ? (
          <div className="cc-empty">{rows.length ? t('inventory.state.noMatch') : t('inventory.locations.empty')}</div>
        ) : (
          <ul className="inv-tree">
            {flat.map((n) => (
              <li key={n.id} className="inv-tree-row" style={{ paddingInlineStart: 8 + (n.depth || 0) * 20 }}>
                <MapPin size={14} aria-hidden="true" style={{ color: 'var(--cc-ink-3)' }} />
                <span className="inv-tree-name"><b>{n.code}</b> {n.name}<br /><code>{n.label_code || labelCode(n.id)}</code></span>
                <StatusPill value={n.location_type} tone={NON_AVAILABLE_TYPES.has(n.location_type) ? 'warning' : 'info'} label={t(`inventory.locationTypes.${n.location_type}`)} />
                {n.active === false && <StatusPill value="inactive" tone="muted" label={t('inventory.locations.inactive')} />}
                <span className="cc-card-sub">{n.site}</span>
                <button type="button" className="cc-icon-btn" aria-label={t('inventory.locations.printOne', { code: n.code })} onClick={() => buildLabels([n])}>
                  <Printer size={14} aria-hidden="true" />
                </button>
                {canManage && (
                  <button type="button" className="cc-icon-btn" aria-label={t('inventory.locations.edit', { code: n.code })} onClick={() => open(n)}>
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Modal className="cc inv-panel" open={!!editing} onClose={() => !busy && setEditing(null)} size="md"
        title={editing?.draft?.id ? t('inventory.locations.editTitle') : t('inventory.locations.addTitle')}
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => setEditing(null)} disabled={busy}>{t('inventory.actions.cancel')}</button>
            <button type="button" className="cc-btn-primary" onClick={submit} disabled={busy}>{busy ? t('inventory.actions.saving') : t('inventory.actions.save')}</button>
          </div>
        )}>
        {editing && <LocationForm draft={editing.draft} setDraft={(fn) => setEditing((e) => ({ ...e, draft: fn(e.draft) }))} errors={errors} rows={flatAll} stores={stores} t={t} />}
        {saveErr && <ErrorNote error={saveErr} />}
      </Modal>

      {bulkOpen && (
        <LocationBulkSetup open={bulkOpen} onClose={() => setBulkOpen(false)} onCreated={onBulkCreated}
          stores={stores} rows={flatAll} defaultSite={defaultSite} t={t} />
      )}

      <Modal className="cc inv-panel" open={!!labels} onClose={() => setLabels(null)} size="xl" title={t('inventory.locations.labelSheet')}
        subtitle={t('inventory.locations.labelSheetSub')}
        footer={(
          <div className="inv-actions">
            <label className="inv-actions">
              <span className="cc-card-sub">{t('inventory.locations.labelSize')}</span>
              <select className="cc-select" value={labelSize} onChange={(e) => setLabelSize(e.target.value)}>
                {Object.values(LABEL_SIZES).map((s) => (
                  <option key={s.key} value={s.key}>{t(`inventory.locations.sizes.${s.key}`, { mm: s.w })}</option>
                ))}
              </select>
            </label>
            <button type="button" className="cc-btn-ghost" onClick={() => window.print()}><Printer size={14} aria-hidden="true" /> {t('inventory.actions.print')}</button>
            <button type="button" className="cc-btn-primary" onClick={downloadPdf}><FileDown size={14} aria-hidden="true" /> {t('inventory.actions.pdf')}</button>
          </div>
        )}>
        {labelErr && <ErrorNote error={labelErr} />}
        <p className="cc-card-sub">{t('inventory.locations.labelCount', { n: labels?.length || 0, perPage: labelGrid(labelSize).perPage })}</p>
        <div className={`inv-labels inv-labels-${labelSize}`}>
          {(labels || []).map((l) => (
            <div key={l.id} className="inv-label">
              <img src={l.img} alt={t('inventory.locations.qrAlt', { code: l.code })} />
              <b>{l.code}</b>
              <small>{l.path || l.name}</small>
              <small className="inv-mono">{l.site}</small>
            </div>
          ))}
        </div>
      </Modal>
      {labelErr && !labels && <ErrorNote error={labelErr} />}
    </div>
  )
}
