/**
 * Locations: the site -> warehouse -> zone -> rack/shelf -> bin hierarchy,
 * plus custody locations (in transit, quarantine, scrap, supplier, vehicle).
 * Each location prints a QR label carrying `TP:LOC:<id>`, which the Flutter
 * count screens scan to open the right bin.
 */
import { useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Plus, Pencil, Printer, FileDown, MapPin } from 'lucide-react'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { listLocations, saveLocation, newIdempotencyKey } from '../../lib/api/inventory'
import {
  buildTree, flattenTree, filterTree, labelCode, validateLocationDraft, LOCATION_TYPES, NON_AVAILABLE_TYPES,
} from '../../lib/inventory/locationTree'
import { labelGrid } from '../../lib/qrLabelLayout'
import { loadPdf } from '../../lib/pdfEngine'
import { reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import { useInvQuery, ErrorNote, NotSetUp, Note, Field, SearchBox, SectionCard, StatusPill } from './InvUi'

const EMPTY = { id: null, code: '', name: '', location_type: 'bin', parent_id: '', site: '', responsible_user_id: '', active: true }

function LocationForm({ draft, setDraft, errors, rows, t }) {
  const parents = rows.filter((r) => r.id !== draft.id && (!draft.site || r.site === draft.site))
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const err = (k) => (errors[k] ? t(errors[k]) : null)
  return (
    <div className="inv-form">
      <Field label={t('inventory.locations.code')} error={err('code')}>
        <input className="inv-input" value={draft.code} onChange={set('code')} maxLength={40} autoComplete="off" />
      </Field>
      <Field label={t('inventory.locations.name')} error={err('name')}>
        <input className="inv-input" value={draft.name} onChange={set('name')} maxLength={120} />
      </Field>
      <Field label={t('inventory.locations.type')} error={err('location_type')}>
        <select className="cc-select" value={draft.location_type} onChange={set('location_type')}>
          {LOCATION_TYPES.map((ty) => <option key={ty} value={ty}>{t(`inventory.locationTypes.${ty}`)}</option>)}
        </select>
      </Field>
      <Field label={t('inventory.scope.site')} error={err('site')}>
        <input className="inv-input" value={draft.site} onChange={set('site')} maxLength={80} />
      </Field>
      <Field label={t('inventory.locations.parent')} error={err('parent_id')} full>
        <select className="cc-select" value={draft.parent_id || ''} onChange={set('parent_id')}>
          <option value="">{t('inventory.locations.noParent')}</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.path || p.code}</option>)}
        </select>
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

export default function LocationsSection({ scope, can }) {
  const { t } = useLanguage()
  const q = useInvQuery(() => listLocations(scope), [scope.country, scope.site])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [errors, setErrors] = useState({})
  const [saveErr, setSaveErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [labels, setLabels] = useState(null)
  const [labelErr, setLabelErr] = useState('')
  const canManage = can('transfer')

  const rows = q.data?.rows || []
  const flatAll = useMemo(() => flattenTree(buildTree(rows)), [rows])
  const tree = useMemo(() => filterTree(buildTree(rows), search), [rows, search])
  const flat = useMemo(() => flattenTree(tree), [tree])

  const open = (row) => {
    setErrors({}); setSaveErr('')
    setEditing({ draft: row ? { ...EMPTY, ...row, parent_id: row.parent_id || '' } : { ...EMPTY, site: scope.site !== 'all' ? scope.site : '' }, key: newIdempotencyKey() })
  }

  const submit = async () => {
    const v = validateLocationDraft(editing.draft, rows)
    setErrors(v.errors)
    if (!v.ok) return
    setBusy(true); setSaveErr('')
    try {
      await saveLocation({ ...editing.draft, country: scope.country }, editing.key)
      setEditing(null)
      q.retry()
    } catch (err) {
      setSaveErr(toUserMessage(err))
    } finally { setBusy(false) }
  }

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
      const grid = labelGrid('md')
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
        doc.addImage(l.img, 'PNG', x + 7, y + 2, qr, qr)
        doc.setFontSize(9); doc.text(String(l.code), x + grid.w / 2, y + qr + 5, { align: 'center', maxWidth: grid.w - 4 })
        doc.setFontSize(6.5); doc.text(`${labelCode(l.id)}`, x + grid.w / 2, y + qr + 8.5, { align: 'center', maxWidth: grid.w - 4 })
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
            <button type="button" className="cc-btn-primary" onClick={() => open(null)}>
              <Plus size={14} aria-hidden="true" /> {t('inventory.locations.add')}
            </button>
          )}
        </div>
      </div>
      {q.data?.truncated && <Note tone="warn">{t('inventory.state.truncated')}</Note>}
      {!canManage && <Note>{t('inventory.locations.readOnly')}</Note>}

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

      <Modal open={!!editing} onClose={() => !busy && setEditing(null)} size="md"
        title={editing?.draft?.id ? t('inventory.locations.editTitle') : t('inventory.locations.addTitle')}
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => setEditing(null)} disabled={busy}>{t('inventory.actions.cancel')}</button>
            <button type="button" className="cc-btn-primary" onClick={submit} disabled={busy}>{busy ? t('inventory.actions.saving') : t('inventory.actions.save')}</button>
          </div>
        )}>
        {editing && <LocationForm draft={editing.draft} setDraft={(fn) => setEditing((e) => ({ ...e, draft: fn(e.draft) }))} errors={errors} rows={flatAll} t={t} />}
        {saveErr && <ErrorNote error={saveErr} />}
      </Modal>

      <Modal open={!!labels} onClose={() => setLabels(null)} size="xl" title={t('inventory.locations.labelSheet')}
        subtitle={t('inventory.locations.labelSheetSub')}
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => window.print()}><Printer size={14} aria-hidden="true" /> {t('inventory.actions.print')}</button>
            <button type="button" className="cc-btn-primary" onClick={downloadPdf}><FileDown size={14} aria-hidden="true" /> {t('inventory.actions.pdf')}</button>
          </div>
        )}>
        {labelErr && <ErrorNote error={labelErr} />}
        <div className="inv-labels">
          {(labels || []).map((l) => (
            <div key={l.id} className="inv-label">
              <img src={l.img} alt={t('inventory.locations.qrAlt', { code: l.code })} />
              <b>{l.code}</b>
              <small>{l.path || l.name}</small>
              <small className="inv-mono">{labelCode(l.id)}</small>
            </div>
          ))}
        </div>
      </Modal>
      {labelErr && !labels && <ErrorNote error={labelErr} />}
    </div>
  )
}
