/**
 * Bulk warehouse / rack / shelf / bin setup for ONE existing store.
 *
 * Step 1 describes the layout (prefix, racks, shelves per rack, bins per
 * shelf). Step 2 is the preview: every code the server would create, which
 * ones already exist and are reused, checked again by the server in a dry run.
 * Nothing is saved until the person presses "Create" on the preview.
 */
import { useMemo, useState } from 'react'
import { Eye, Layers, ArrowLeft, Container, DoorOpen, SlidersHorizontal, Plus } from 'lucide-react'
import Modal from '../ui/Modal'
import { bulkCreateLocations, newIdempotencyKey } from '../../lib/api/inventory'
import { buildBulkPlan, bulkPayload, templateSpec, BULK_MAX_NODES } from '../../lib/inventory/locationBulk'
import { toUserMessage } from '../../lib/inventory/errorText'
import { ErrorNote, Field, Note, StatusPill } from './InvUi'

const PREVIEW_ROWS = 300
const PARENT_TYPES = new Set(['warehouse', 'zone', 'rack'])

export default function LocationBulkSetup({ open, onClose, onCreated, stores, rows, defaultSite, t }) {
  const [spec, setSpec] = useState(() => ({
    site: defaultSite || '', parentId: '', prefix: '', racks: '', shelves: 5, bins: 10, start: 1, pad: 2, sep: '-',
    rackLabel: t('inventory.locationTypes.rack'), shelfLabel: t('inventory.locationTypes.shelf'), binLabel: t('inventory.locationTypes.bin'),
  }))
  const [step, setStep] = useState('edit')
  const [server, setServer] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [key, setKey] = useState(() => newIdempotencyKey())
  // Codes created in this dialog, so "Add another container" keeps numbering
  // (C02, C03) before the parent list has reloaded.
  const [made, setMade] = useState([])
  const [lastDone, setLastDone] = useState(null)

  const applyTemplate = (kind, site = spec.site, extra = made, size = spec.containerSize || '20ft') => {
    setStep('edit'); setServer(null); setErr(''); setLastDone(null)
    if (kind === 'custom') { setSpec((s) => ({ ...s, template: null, zoneCode: '', zoneName: '', rackNames: null })); return }
    const word = t(`inventory.locations.bulk.tpl.${kind}`)
    const tpl = templateSpec(kind, { site, rows, extraCodes: extra, word, size })
    if (!tpl) { setSpec((s) => ({ ...s, template: kind })); return }
    const rackNames = kind === 'container'
      ? { L: t('inventory.locations.bulk.tpl.leftWall'), R: t('inventory.locations.bulk.tpl.rightWall') } : null
    setSpec((s) => ({ ...s, ...tpl, rackNames }))
  }

  const store = stores.find((s) => s.name === spec.site) || null
  const parents = useMemo(() => rows.filter((r) => r.site === String(spec.site).toUpperCase()
    && r.active !== false && PARENT_TYPES.has(r.location_type)), [rows, spec.site])
  const plan = useMemo(() => buildBulkPlan(spec, rows), [spec, rows])

  const set = (k) => (e) => {
    const v = e.target.value
    setStep('edit'); setServer(null); setErr('')
    setSpec((s) => {
      const next = { ...s, [k]: v }
      if (k === 'site') { next.parentId = ''; next.prefix = ''; next.zoneCode = ''; next.zoneName = '' }
      if (k === 'parentId') next.prefix = rows.find((r) => r.id === v)?.code || ''
      return next
    })
  }

  const payload = () => bulkPayload({ country: store?.country, site: spec.site, parentId: spec.parentId, nodes: plan.nodes })

  const preview = async () => {
    if (plan.errors.length || !plan.nodes.length) return
    setBusy(true); setErr('')
    try {
      const r = await bulkCreateLocations(payload(), newIdempotencyKey(), { dryRun: true })
      setServer(r); setStep('preview')
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const r = await bulkCreateLocations(payload(), key)
      setKey(newIdempotencyKey())
      const codes = plan.nodes.map((n) => n.code)
      const keepOpen = !!spec.template && !!spec.zoneCode
      if (keepOpen) {
        setMade((m) => [...m, ...codes])
        setLastDone({ created: r?.created ?? 0, existing: r?.existing ?? 0, zone: spec.zoneCode })
        setStep('done')
      }
      onCreated(r, codes, { keepOpen })
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  const serverStatus = new Map((server?.nodes || []).map((n) => [n.code, n.status]))
  const shown = plan.nodes.slice(0, PREVIEW_ROWS)

  return (
    <Modal className="cc inv-panel" open={open} onClose={() => !busy && onClose()} size="xl"
      title={t('inventory.locations.bulk.title')} subtitle={t('inventory.locations.bulk.sub')}
      footer={(
        <div className="inv-actions">
          {step === 'preview' && (
            <button type="button" className="cc-btn-ghost" onClick={() => setStep('edit')} disabled={busy}>
              <ArrowLeft size={14} aria-hidden="true" /> {t('inventory.locations.bulk.back')}
            </button>
          )}
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>{t('inventory.actions.cancel')}</button>
          {step === 'done' ? null : step === 'edit' ? (
            <button type="button" className="cc-btn-primary" onClick={preview} disabled={busy || !!plan.errors.length || !plan.nodes.length || !store}>
              <Eye size={14} aria-hidden="true" /> {busy ? t('inventory.locations.bulk.checking') : t('inventory.locations.bulk.preview')}
            </button>
          ) : (
            <button type="button" className="cc-btn-primary" onClick={create} disabled={busy || !server?.created}>
              <Layers size={14} aria-hidden="true" /> {busy ? t('inventory.actions.saving') : t('inventory.locations.bulk.create', { n: server?.created ?? 0 })}
            </button>
          )}
        </div>
      )}>
      {step === 'done' && lastDone && (
        <div className="inv-hub">
          <Note tone="good">{t('inventory.locations.bulk.tpl.done', { zone: lastDone.zone, created: lastDone.created, existing: lastDone.existing })}</Note>
          <div className="inv-actions">
            <button type="button" className="cc-btn-primary" onClick={() => applyTemplate(spec.template, spec.site, made)}>
              <Plus size={14} aria-hidden="true" /> {t(`inventory.locations.bulk.tpl.another.${spec.template}`)}
            </button>
          </div>
        </div>
      )}
      {step === 'edit' && (
        <div className="inv-form">
          <div className="inv-full" role="group" aria-label={t('inventory.locations.bulk.tpl.label')}>
            <p className="cc-card-sub">{t('inventory.locations.bulk.tpl.label')}</p>
            <div className="inv-tpl-row">
              {[['custom', SlidersHorizontal], ['container', Container], ['room', DoorOpen]].map(([k, Icon]) => (
                <button key={k} type="button" className="inv-tpl" aria-pressed={(spec.template || 'custom') === k} onClick={() => applyTemplate(k)}>
                  <Icon size={18} aria-hidden="true" />
                  <b>{t(`inventory.locations.bulk.tpl.${k}`)}</b>
                  <small>{t(`inventory.locations.bulk.tpl.${k}Hint`)}</small>
                </button>
              ))}
            </div>
          </div>
          {spec.template === 'container' && (
            <Field label={t('inventory.locations.bulk.tpl.size')} full>
              <select className="cc-select" value={spec.containerSize || '20ft'} onChange={(e) => applyTemplate('container', spec.site, made, e.target.value)}>
                <option value="20ft">{t('inventory.locations.bulk.tpl.size20')}</option>
                <option value="40ft">{t('inventory.locations.bulk.tpl.size40')}</option>
              </select>
            </Field>
          )}
          <Field label={t('inventory.locations.store')} full>
            <select className="cc-select" value={spec.site} onChange={(e) => { set('site')(e); if (spec.template) applyTemplate(spec.template, e.target.value) }}>
              <option value="">{t('inventory.common.choose')}</option>
              {stores.map((s) => <option key={`${s.country}:${s.name}`} value={s.name}>{s.name}{s.country ? ` (${s.country})` : ''}</option>)}
            </select>
          </Field>
          <Field label={t('inventory.locations.parent')} full>
            <select className="cc-select" value={spec.parentId} onChange={set('parentId')} disabled={!spec.site}>
              <option value="">{t('inventory.locations.bulk.topOfStore')}</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.path || p.code} ({t(`inventory.locationTypes.${p.location_type}`)})</option>)}
            </select>
          </Field>
          {spec.template && (
            <>
              <Field label={t('inventory.locations.bulk.tpl.zoneCode')}>
                <input className="inv-input inv-mono" value={spec.zoneCode || ''} onChange={(e) => { const v = e.target.value.toUpperCase(); setStep('edit'); setServer(null); setSpec((s) => ({ ...s, zoneCode: v, prefix: v })) }} maxLength={30} autoComplete="off" />
              </Field>
              <Field label={t('inventory.locations.bulk.tpl.zoneName')}>
                <input className="inv-input" value={spec.zoneName || ''} onChange={set('zoneName')} maxLength={60} autoComplete="off" />
              </Field>
            </>
          )}
          <Field label={t('inventory.locations.bulk.prefix')}>
            <input className="inv-input" value={spec.prefix} onChange={set('prefix')} maxLength={20} autoComplete="off" placeholder="WH1" />
          </Field>
          <Field label={t('inventory.locations.bulk.racks')}>
            <input className="inv-input" value={spec.racks} onChange={set('racks')} maxLength={60} autoComplete="off" placeholder="A-C" />
          </Field>
          <Field label={t('inventory.locations.bulk.shelves')}>
            <input className="inv-input" type="number" min={0} max={99} value={spec.shelves} onChange={set('shelves')} />
          </Field>
          <Field label={t('inventory.locations.bulk.bins')}>
            <input className="inv-input" type="number" min={0} max={99} value={spec.bins} onChange={set('bins')} />
          </Field>
          <Field label={t('inventory.locations.bulk.start')}>
            <input className="inv-input" type="number" min={0} max={999} value={spec.start} onChange={set('start')} />
          </Field>
          <Field label={t('inventory.locations.bulk.pad')}>
            <select className="cc-select" value={spec.pad} onChange={set('pad')}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{String(1).padStart(n, '0')}</option>)}
            </select>
          </Field>
          <Field label={t('inventory.locations.bulk.sep')}>
            <select className="cc-select" value={spec.sep} onChange={set('sep')}>
              <option value="-">A-01-01</option><option value=".">A.01.01</option><option value="_">A_01_01</option><option value="">A0101</option>
            </select>
          </Field>
          <Field label={t('inventory.locations.bulk.names')}>
            <div className="inv-actions">
              <input className="inv-input" style={{ flex: 1 }} aria-label={t('inventory.locationTypes.rack')} value={spec.rackLabel} onChange={set('rackLabel')} maxLength={20} />
              <input className="inv-input" style={{ flex: 1 }} aria-label={t('inventory.locationTypes.shelf')} value={spec.shelfLabel} onChange={set('shelfLabel')} maxLength={20} />
              <input className="inv-input" style={{ flex: 1 }} aria-label={t('inventory.locationTypes.bin')} value={spec.binLabel} onChange={set('binLabel')} maxLength={20} />
            </div>
          </Field>
          <div className="inv-full">
            {plan.errors.length > 0
              ? plan.errors.map((k) => <p key={k} className="inv-err" role="alert">{t(k, { max: BULK_MAX_NODES })}</p>)
              : <Note>{plan.counts.zone ? `${t('inventory.locations.bulk.tpl.zoneSummary', { zone: spec.zoneCode })} ` : ''}{t('inventory.locations.bulk.summary', { racks: plan.counts.rack, shelves: plan.counts.shelf, bins: plan.counts.bin, existing: plan.counts.existing })}</Note>}
          </div>
          {plan.nodes.length > 0 && (
            <div className="inv-full inv-scroll">
              <p className="cc-card-sub">{t('inventory.locations.bulk.example')}: <span className="inv-mono">{plan.nodes.slice(0, 4).map((n) => n.code).join(', ')}{plan.nodes.length > 4 ? ' ...' : ''}</span></p>
            </div>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div className="inv-hub">
          <Note tone={server?.existing ? 'warn' : 'info'}>
            {t('inventory.locations.bulk.previewNote', { created: server?.created ?? 0, existing: server?.existing ?? 0, site: spec.site })}
          </Note>
          <div className="cc-et inv-scroll">
            <table>
              <thead><tr>
                <th>{t('inventory.locations.code')}</th><th>{t('inventory.locations.name')}</th>
                <th>{t('inventory.locations.type')}</th><th>{t('inventory.common.status')}</th>
              </tr></thead>
              <tbody>
                {shown.map((n) => {
                  const st = serverStatus.get(n.code) || (n.existingId ? 'existing' : 'new')
                  return (
                    <tr key={n.ref}>
                      <td className="inv-mono" style={{ paddingInlineStart: 8 + n.depth * 16 }}>{n.code}</td>
                      <td>{n.name}</td>
                      <td>{t(`inventory.locationTypes.${n.location_type}`)}</td>
                      <td><StatusPill value={st} tone={st === 'existing' ? 'muted' : 'good'} label={t(`inventory.locations.bulk.status.${st}`)} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {plan.nodes.length > PREVIEW_ROWS && <Note>{t('inventory.locations.bulk.more', { n: plan.nodes.length - PREVIEW_ROWS })}</Note>}
        </div>
      )}
      {err && <ErrorNote error={err} />}
    </Modal>
  )
}
