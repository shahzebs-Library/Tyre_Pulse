/**
 * Physical Inventory: the one entry point for "Start Physical Inventory",
 * identification review, company materials, global
 * material search and the management dashboard.
 *
 * A capture is evidence (what was found, where, how many, by whom, with
 * photos). It never changes official stock: identified captures become an
 * opening-balance batch that another person approves through the existing
 * governed workflow (Controls > Opening balances), which posts through the
 * immutable ledger. Unidentified items get a temporary reference and wait for
 * engineering / master-data review.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ClipboardList, FileDown, Minus, Play, Plus, Save, ScanLine, Search, Square, Store } from 'lucide-react'
import { Tabs, Kpi } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import { listSites } from '../../lib/api/sites'
import { listLocations, newIdempotencyKey } from '../../lib/api/inventory'
import {
  listSessions, startSession, closeSession, prepareOpeningBatch, recordCapture, listCaptures, searchMaterials,
  uploadPhoto, loadDashboard, listStoreSiteHints,
} from '../../lib/api/physicalInventory'
import CodeScanCamera, { codeScanSupported } from './CodeScanCamera'
import {
  CONDITIONS, OWNERSHIPS, CODE_TYPES, PHOTO_ROLES, captureAttempt, guessCodeType, groupVariants,
  identificationTone, classificationTone, dashboardTiles, identificationProgress, dashboardExportRows, newClientUuid,
  storeChoices, stepQuantity, locationFromScan,
} from '../../lib/inventory/physicalInventory'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/inventory/errorText'
import {
  useInvQuery, useHubTab, ErrorNote, NotSetUp, Note, Field, SectionCard, StatusPill, PagedTable, fmtDateTime,
} from './InvUi'

const PhysicalInventoryReview = lazy(() => import('./PhysicalInventoryReview'))
// Corrections is its own section in the app sidebar (CorrectionsSection), not a tab here.
const TABS = ['capture', 'review', 'materials', 'search', 'dashboard']
const EMPTY_FORM = { scanned_code: '', scanned_code_type: '', picked: null, refs: {}, quantity: '', uom: '', condition: 'new',
  ownership: 'owned', location_id: '', location_hint: '', remarks: '', photos: [], photoRole: 'item' }

function SessionStart({ scope, onStarted, t }) {
  const [sites, setSites] = useState([])
  const [hints, setHints] = useState([])
  const [site, setSite] = useState(scope.site && scope.site !== 'all' ? scope.site : '')
  const [loc, setLoc] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const key = useRef(newIdempotencyKey())
  const locations = useInvQuery(() => (site ? listLocations({ country: scope.country, site }) : Promise.resolve({ status: 'ok', rows: [] })), [scope.country, site])
  useEffect(() => {
    let live = true
    listSites({ country: scope.country, activeOnly: true }).then((r) => { if (live) setSites(r || []) }).catch(() => { if (live) setSites([]) })
    listStoreSiteHints(scope.country).then((h) => { if (live) setHints(h) }).catch(() => { if (live) setHints([]) })
    return () => { live = false }
  }, [scope.country])
  const choices = useMemo(() => storeChoices(sites, hints), [sites, hints])
  const storage = (locations.data?.rows || []).filter((l) => l.active !== false && !['in_transit', 'supplier_custody', 'vehicle_custody'].includes(l.location_type))

  const start = async () => {
    setBusy(true); setErr('')
    try {
      const r = await startSession({ country: scope.country, site, locationId: loc || null, notes }, key.current)
      key.current = newIdempotencyKey()
      onStarted(r.id)
    } catch (x) { setErr(toUserMessage(x)) } finally { setBusy(false) }
  }

  return (
    <SectionCard title={t('inventory.pi.start.title')} sub={t('inventory.pi.start.sub')}>
      {!scope.country && <Note tone="warn">{t('inventory.pi.start.pickCountry')}</Note>}
      <div className="inv-form">
        {choices.primary.length > 0 && (
          <div className="inv-full" role="group" aria-label={t('inventory.pi.start.stores')}>
            <p className="cc-card-sub">{t('inventory.pi.start.stores')}</p>
            <div className="inv-pi-stores">
              {choices.primary.map((s) => (
                <button key={s} type="button" className={`inv-pi-store ${site === s ? 'active' : ''}`} aria-pressed={site === s}
                  onClick={() => { setSite(s); setLoc('') }}>
                  <Store size={18} aria-hidden="true" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label={choices.primary.length ? t('inventory.pi.start.otherSite') : t('inventory.pi.start.store')}>
          <select className="cc-select" value={site} onChange={(e) => { setSite(e.target.value); setLoc('') }}>
            <option value="">{t('inventory.pi.start.chooseStore')}</option>
            {[...choices.primary, ...choices.others].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={t('inventory.pi.start.location')}>
          <select className="cc-select" value={loc} onChange={(e) => setLoc(e.target.value)} disabled={!site}>
            <option value="">{t('inventory.pi.start.wholeStore')}</option>
            {storage.map((l) => <option key={l.id} value={l.id}>{l.code}{l.name ? ` - ${l.name}` : ''}</option>)}
          </select>
        </Field>
        <Field label={t('inventory.pi.common.notes')} full>
          <input className="inv-input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
        </Field>
      </div>
      {site && locations.data?.status === 'ok' && storage.length === 0 && <Note>{t('inventory.pi.start.noLocations')}</Note>}
      {err && <ErrorNote error={err} />}
      <div className="inv-actions">
        <button type="button" className="cc-btn-primary" disabled={busy || !scope.country || !site} onClick={start}>
          <Play size={14} aria-hidden="true" /> {busy ? t('inventory.actions.saving') : t('inventory.pi.start.button')}
        </button>
      </div>
    </SectionCard>
  )
}

function PickResults({ result, onPick, t }) {
  if (!result) return null
  if (result.status === 'not_provisioned') return <NotSetUp what={t('inventory.pi.title')} />
  if (!result.results.length) return <Note>{t('inventory.pi.capture.noMatch')}</Note>
  return (
    <div className="inv-pi-results">
      {result.results.map((r) => {
        const g = groupVariants(r)
        return (
          <div key={r.canonical_id} className="inv-pi-result">
            <div>
              <strong>{r.description}</strong> <span className="cc-na">{r.company_sku || t('inventory.pi.common.noCompanySku')}</span>
              {r.status !== 'active' && <StatusPill value={r.status} tone="warn" label={t(`inventory.pi.status.${r.status}`)} />}
            </div>
            <div className="inv-pi-variants">
              {['genuine', 'oes', 'aftermarket', 'unknown'].flatMap((k) => g[k].map((v) => (
                <button key={v.variant_id} type="button" className="cc-btn-ghost" onClick={() => onPick({ canonical_id: r.canonical_id, variant_id: v.variant_id, label: `${r.description} / ${v.manufacturer || ''} ${v.part_number || ''}` })}>
                  <StatusPill value={k} tone={classificationTone(k)} label={t(`inventory.pi.cls.${k}`)} /> {v.manufacturer || ''} {v.part_number || ''}
                </button>
              )))}
              <button type="button" className="cc-btn-ghost" onClick={() => onPick({ canonical_id: r.canonical_id, variant_id: null, label: r.description })}>
                {t('inventory.pi.capture.pickWithoutVariant')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CaptureDesk({ session, orgId, onChanged, t }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [last, setLast] = useState(null)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(25)
  const [stamp, setStamp] = useState(0)
  const codeRef = useRef(null)
  const clientUuid = useRef(newClientUuid())
  const frozen = useRef(null)
  const [retry, setRetry] = useState(null)
  const [camera, setCamera] = useState(false)
  const [locNote, setLocNote] = useState('')
  const canScan = codeScanSupported()
  const locations = useInvQuery(() => listLocations({ country: session.country, site: session.site }), [session.id])
  const captures = useInvQuery(() => listCaptures({ sessionId: session.id, page, pageSize: size }), [session.id, page, size, stamp])
  const locs = (locations.data?.rows || []).filter((l) => l.active !== false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const bump = (delta) => setForm((f) => ({ ...f, quantity: stepQuantity(f.quantity, delta) }))
  const setRef = (k) => (e) => setForm((f) => ({ ...f, refs: { ...f.refs, [k]: e.target.value } }))

  const lookup = async (raw) => {
    const code = String(raw ?? form.scanned_code).trim()
    if (!code) return
    setErr(''); setLocNote('')
    // A printed TP:LOC: label picks the bin instead of searching for a material.
    const loc = locationFromScan(code, locs)
    if (loc) {
      setForm((f) => ({ ...f, location_id: loc.id, scanned_code: '', scanned_code_type: '' }))
      setLocNote(loc.code)
      codeRef.current?.focus()
      return
    }
    if (raw !== undefined) setForm((f) => ({ ...f, scanned_code: code }))
    setForm((f) => ({ ...f, scanned_code_type: f.scanned_code_type || guessCodeType(code) }))
    try { setResult(await searchMaterials(code)) } catch (x) { setErr(toUserMessage(x)) }
  }

  const uploadAll = async (files, captureId, role, purpose) => {
    const failed = []
    for (const file of files) {
      try {
        await uploadPhoto(file, { orgId, sessionId: session.id, target: { captureId }, role, purpose })
      } catch { failed.push(file) }
    }
    return failed
  }

  const save = async (e) => {
    e?.preventDefault()
    const attempt = captureAttempt(frozen.current, form, { sessionId: session.id, clientUuid: clientUuid.current, deviceId: 'web' })
    if (attempt.error) { setErr(t(`inventory.pi.capture.err.${attempt.error}`)); return }
    frozen.current = attempt.frozen
    setBusy(true); setErr('')
    try {
      const r = await recordCapture(attempt.payload)
      frozen.current = null
      clientUuid.current = newClientUuid()
      const purpose = attempt.payload.kind === 'identified' ? 'count_proof' : 'identification'
      const failed = await uploadAll(form.photos, r.id, form.photoRole, purpose)
      // Files that did not upload are kept (never cleared) and offered for retry on this capture.
      setRetry(failed.length ? { captureId: r.id, files: failed, role: form.photoRole, purpose } : null)
      setLast({ ...r, failedPhotos: failed.length })
      setForm((f) => ({ ...EMPTY_FORM, location_id: f.location_id, location_hint: f.location_hint, condition: f.condition, ownership: f.ownership }))
      setResult(null)
      setStamp((s) => s + 1)
      onChanged?.()
      codeRef.current?.focus()
    } catch (x) { setErr(toUserMessage(x)) } finally { setBusy(false) }
  }

  const retryPhotos = async () => {
    if (!retry) return
    setBusy(true)
    const failed = await uploadAll(retry.files, retry.captureId, retry.role, retry.purpose)
    setRetry(failed.length ? { ...retry, files: failed } : null)
    setLast((l) => (l ? { ...l, failedPhotos: failed.length } : l))
    setStamp((s) => s + 1)
    setBusy(false)
  }

  const discardFrozen = () => { frozen.current = null; clientUuid.current = newClientUuid(); setErr('') }

  const cols = [
    { key: 'captured_at', header: t('inventory.pi.common.when'), cell: (r) => fmtDateTime(r.captured_at) },
    { key: 'what', header: t('inventory.pi.common.material'), cell: (r) => r.canonical_description || r.temp_ref || r.scanned_code || t('wmsfloor.common.na') },
    { key: 'location', header: t('inventory.pi.common.location'), cell: (r) => r.location_code || r.location_hint || t('wmsfloor.common.na') },
    { key: 'quantity', header: t('inventory.pi.common.qty'), numeric: true },
    { key: 'condition', header: t('inventory.pi.common.condition'), cell: (r) => t(`inventory.pi.cond.${r.condition}`) },
    { key: 'identification_status', header: t('inventory.pi.common.status'), cell: (r) => <StatusPill value={r.identification_status} tone={identificationTone(r.identification_status)} label={t(`inventory.pi.status.${r.identification_status}`)} /> },
    { key: 'photo_count', header: t('inventory.pi.common.photos'), numeric: true },
  ]

  return (
    <>
      <SectionCard title={t('inventory.pi.capture.title')} sub={t('inventory.pi.capture.sub')}>
        <form onSubmit={save} className="inv-hub" style={{ gap: 12 }}>
          <div className="cc-filters">
            <div className="cc-search inv-pi-scan" style={{ flex: 2 }}>
              <ScanLine size={20} aria-hidden="true" />
              <input ref={codeRef} autoFocus value={form.scanned_code} onChange={set('scanned_code')}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup() } }}
                placeholder={t('inventory.pi.capture.codePlaceholder')} aria-label={t('inventory.pi.capture.codePlaceholder')} autoComplete="off" />
            </div>
            <select className="cc-select" value={form.scanned_code_type} onChange={set('scanned_code_type')} aria-label={t('inventory.pi.capture.codeType')}>
              <option value="">{t('inventory.pi.capture.codeTypeAuto')}</option>
              {CODE_TYPES.map((c) => <option key={c} value={c}>{t(`inventory.pi.codeType.${c}`)}</option>)}
            </select>
            {canScan && (
              <button type="button" className="cc-btn inv-pi-big" onClick={() => setCamera(true)} aria-label={t('inventory.pi.capture.scanCamera')}>
                <Camera size={18} aria-hidden="true" /> {t('inventory.pi.capture.scan')}
              </button>
            )}
            <button type="button" className="cc-btn inv-pi-big" onClick={() => lookup()} disabled={!form.scanned_code.trim()}><Search size={18} aria-hidden="true" /> {t('inventory.pi.capture.find')}</button>
          </div>
          {locNote && <Note tone="good">{t('inventory.pi.capture.locationScanned', { code: locNote })}</Note>}
          <CodeScanCamera open={camera} t={t} onClose={() => setCamera(false)} onCode={(c) => { setCamera(false); lookup(c) }} />
          {form.picked
            ? <Note tone="good" title={t('inventory.pi.capture.picked')} action={<button type="button" className="cc-btn-ghost" onClick={() => setForm((f) => ({ ...f, picked: null }))}>{t('inventory.pi.capture.clearPick')}</button>}>{form.picked.label}</Note>
            : <PickResults result={result} t={t} onPick={(p) => setForm((f) => ({ ...f, picked: p }))} />}
          {!form.picked && (
            <details className="inv-pi-describe" open={!!result && !result.results?.length}>
              <summary>{t('inventory.pi.capture.describe')}</summary>
              <div className="inv-form">
                {['description', 'manufacturer', 'brand', 'oem', 'aftermarket', 'company_sku', 'erp_sku'].map((k) => (
                  <Field key={k} label={t(`inventory.pi.ref.${k}`)} full={k === 'description'}>
                    <input className="inv-input" value={form.refs[k] || ''} onChange={setRef(k)} maxLength={k === 'description' ? 300 : 120} />
                  </Field>
                ))}
              </div>
              <Note>{t('inventory.pi.capture.unidentifiedHint')}</Note>
            </details>
          )}
          <div className="inv-form">
            <div className="cc-field" style={{ minWidth: 0 }}>
              <span id="pi-qty-label">{t('inventory.pi.common.qty')}</span>
              <div className="inv-pi-qty">
                <button type="button" className="cc-btn inv-pi-big" onClick={() => bump(-1)} aria-label={t('inventory.pi.capture.qtyLess')}><Minus size={20} aria-hidden="true" /></button>
                <input className="inv-input inv-pi-qty-input" inputMode="decimal" value={form.quantity} onChange={set('quantity')} required aria-labelledby="pi-qty-label" />
                <button type="button" className="cc-btn inv-pi-big" onClick={() => bump(1)} aria-label={t('inventory.pi.capture.qtyMore')}><Plus size={20} aria-hidden="true" /></button>
              </div>
            </div>
            <Field label={t('inventory.pi.common.uom')}>
              <input className="inv-input" value={form.uom} onChange={set('uom')} maxLength={20} />
            </Field>
            <Field label={t('inventory.pi.common.condition')}>
              <select className="cc-select" value={form.condition} onChange={set('condition')}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{t(`inventory.pi.cond.${c}`)}</option>)}
              </select>
            </Field>
            <Field label={t('inventory.pi.common.ownership')}>
              <select className="cc-select" value={form.ownership} onChange={set('ownership')}>
                {OWNERSHIPS.map((c) => <option key={c} value={c}>{t(`inventory.pi.own.${c}`)}</option>)}
              </select>
            </Field>
            <Field label={t('inventory.pi.common.location')}>
              <select className="cc-select" value={form.location_id} onChange={set('location_id')}>
                <option value="">{session.location_id ? t('inventory.pi.capture.sessionLocation') : t('inventory.pi.start.wholeStore')}</option>
                {locs.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
              </select>
            </Field>
            <Field label={t('inventory.pi.capture.locationHint')}>
              <input className="inv-input" value={form.location_hint} onChange={set('location_hint')} maxLength={120} />
            </Field>
            <Field label={t('inventory.pi.common.remarks')} full>
              <input className="inv-input" value={form.remarks} onChange={set('remarks')} maxLength={500} />
            </Field>
            <div className="cc-field" style={{ minWidth: 0 }}>
              <span>{t('inventory.pi.capture.photos')}</span>
              <label className="cc-btn inv-pi-big inv-pi-file">
                <Camera size={18} aria-hidden="true" /> {t('inventory.pi.capture.takePhoto')}
                <input type="file" accept="image/*" capture="environment" multiple className="sr-only" aria-label={t('inventory.pi.capture.photos')}
                  onChange={(e) => { const picked = [...(e.target.files || [])]; e.target.value = ''; setForm((f) => ({ ...f, photos: [...f.photos, ...picked].slice(0, 6) })) }} />
              </label>
            </div>
            <Field label={t('inventory.pi.capture.photoRole')}>
              <select className="cc-select" value={form.photoRole} onChange={set('photoRole')}>
                {PHOTO_ROLES.map((r) => <option key={r} value={r}>{t(`inventory.pi.photoRole.${r}`)}</option>)}
              </select>
            </Field>
          </div>
          {err && <ErrorNote error={err} />}
          {err && frozen.current && (
            <Note tone="warn" action={<button type="button" className="cc-btn-ghost" onClick={discardFrozen}>{t('inventory.pi.capture.discardFrozen')}</button>}>
              {t('inventory.pi.capture.frozenNote')}
            </Note>
          )}
          {retry && (
            <Note tone="warn" action={<button type="button" className="cc-btn" disabled={busy} onClick={retryPhotos}>{t('inventory.pi.capture.retryPhotos')}</button>}>
              {t('inventory.pi.capture.photosKept', { n: retry.files.length })}
            </Note>
          )}
          {last && (
            <Note tone={last.failedPhotos ? 'warn' : 'good'} title={last.temp_ref ? t('inventory.pi.capture.savedUnknown', { ref: last.temp_ref }) : t('inventory.pi.capture.saved')}>
              {last.failedPhotos ? t('inventory.pi.capture.photosFailed', { n: last.failedPhotos }) : t('inventory.pi.capture.next')}
            </Note>
          )}
          <div className="inv-actions">
            <button type="submit" className="cc-btn-primary inv-pi-save" disabled={busy}><Save size={20} aria-hidden="true" /> {busy ? t('inventory.actions.saving') : t('inventory.pi.capture.saveNext')}</button>
            <span className="cc-na"><Camera size={13} aria-hidden="true" /> {t('inventory.pi.capture.photoCount', { n: form.photos.length })}</span>
            {form.photos.length > 0 && <button type="button" className="cc-btn-ghost" onClick={() => setForm((f) => ({ ...f, photos: [] }))}>{t('inventory.pi.capture.clearPhotos')}</button>}
          </div>
        </form>
      </SectionCard>
      <SectionCard title={t('inventory.pi.capture.listTitle')}>
        <PagedTable query={captures} columns={cols} page={page} pageSize={size} onPage={setPage} onPageSize={(s) => { setSize(s); setPage(0) }}
          empty={t('inventory.pi.capture.empty')} what={t('inventory.pi.title')} noun={t('inventory.pi.common.captures')} />
      </SectionCard>
    </>
  )
}

function CaptureTab({ scope, orgId, t, onNavigate }) {
  const [active, setActive] = useState(null)
  const [stamp, setStamp] = useState(0)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const sessions = useInvQuery(() => listSessions({ country: scope.country, site: scope.site, status: 'all', pageSize: 50 }), [scope.country, scope.site, stamp])
  const rows = sessions.data?.rows || []
  const session = rows.find((s) => s.id === active) || null

  const act = async (fn) => {
    setBusy(true); setMsg(null)
    try { const r = await fn(); setMsg({ tone: 'good', text: r }); setStamp((s) => s + 1) } catch (x) { setMsg({ tone: 'bad', text: toUserMessage(x) }) } finally { setBusy(false) }
  }

  if (sessions.data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.pi.title')} />
  return (
    <div className="inv-hub">
      {!session && <SessionStart scope={scope} t={t} onStarted={(id) => { setActive(id); setStamp((s) => s + 1) }} />}
      <SectionCard title={t('inventory.pi.sessions.title')} sub={t('inventory.pi.sessions.sub')}>
        {sessions.error ? <ErrorNote error={sessions.error} onRetry={sessions.retry} /> : (
          <div className="inv-pi-sessions">
            {rows.length === 0 && !sessions.loading && <p className="cc-na">{t('inventory.pi.sessions.empty')}</p>}
            {rows.map((s) => (
              <div key={s.id} className={`inv-pi-session ${s.id === active ? 'active' : ''}`}>
                <div><strong>{s.reference}</strong> <span className="cc-na">{s.site} / {fmtDateTime(s.started_at)}</span></div>
                <StatusPill value={s.status} tone={s.status === 'open' ? 'good' : 'muted'} label={t(`inventory.pi.sessionStatus.${s.status}`)} />
                <div className="inv-actions">
                  {s.status === 'open' && s.id !== active && <button type="button" className="cc-btn" onClick={() => setActive(s.id)}><ClipboardList size={14} aria-hidden="true" /> {t('inventory.pi.sessions.resume')}</button>}
                  {s.status === 'open' && <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => act(async () => { await closeSession({ sessionId: s.id }, newIdempotencyKey()); if (active === s.id) setActive(null); return t('inventory.pi.sessions.closed') })}><Square size={14} aria-hidden="true" /> {t('inventory.pi.sessions.close')}</button>}
                  {s.status === 'closed' && !s.opening_batch_id && <button type="button" className="cc-btn" disabled={busy} onClick={() => act(async () => { const r = await prepareOpeningBatch(s.id, newIdempotencyKey()); return t('inventory.pi.sessions.prepared', { n: r.lines, skipped: (r.skipped || []).length }) })}>{t('inventory.pi.sessions.prepare')}</button>}
                  {s.opening_batch_id && <span className="cc-pill info">{t('inventory.pi.sessions.batchReady')}</span>}
                  {s.opening_batch_id && onNavigate && <button type="button" className="cc-btn" onClick={() => onNavigate('controls', 'opening')}>{t('inventory.pi.sessions.openBatch')}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        <Note>{t('inventory.pi.sessions.ledgerRule')}</Note>
      </SectionCard>
      {session && session.status === 'open' && <CaptureDesk session={session} orgId={orgId} t={t} onChanged={() => {}} />}
    </div>
  )
}

function DashboardTab({ scope, t, can }) {
  const { appSettings } = useSettings()
  const d = useInvQuery(() => loadDashboard({ country: scope.country, site: scope.site }), [scope.country, scope.site])
  if (d.error) return <ErrorNote error={d.error} onRetry={d.retry} />
  if (d.data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.pi.title')} />
  const data = d.data
  const tiles = dashboardTiles(data)
  const progress = identificationProgress(data)
  const label = (k) => t(`inventory.pi.dash.${k}`)
  const rows = dashboardExportRows(data, label)
  const cols = ['section', 'name', 'value', 'extra']
  const heads = [t('inventory.pi.dash.section'), t('inventory.pi.dash.name'), t('inventory.pi.dash.value'), t('inventory.pi.dash.extra')]
  const file = reportFileName('Physical inventory', scope.site && scope.site !== 'all' ? scope.site : 'all stores')
  return (
    <div className="inv-hub">
      <div className="inv-kpis">
        {tiles.map((x) => <Kpi key={x.key} icon={ClipboardList} tone={x.tone || 'info'} value={x.value} display={x.value == null ? t('wmsfloor.common.na') : undefined} label={label(x.key)} loading={d.loading && !data} />)}
      </div>
      <SectionCard title={t('inventory.pi.dash.progressTitle')} sub={progress == null ? t('inventory.pi.dash.noCaptures') : t('inventory.pi.dash.progress', { pct: progress })}
        action={can('export') && rows.length > 0 && (
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => exportToExcel(rows, cols, heads, file, 'Physical inventory')}><FileDown size={14} aria-hidden="true" /> Excel</button>
            <button type="button" className="cc-btn-ghost" onClick={() => exportToPdf(rows, cols.map((k, i) => ({ key: k, header: heads[i] })), t('inventory.pi.title'), file, 'landscape', appSettings?.company_name || '')}><FileDown size={14} aria-hidden="true" /> PDF</button>
          </div>
        )}>
        {data && (
          <div className="inv-pi-dash">
            {[['classification', 'cls'], ['condition', 'cond'], ['approval', 'batch'], ['valuation', 'val']].map(([k, ns]) => (
              <div key={k}>
                <h3 className="cc-card-sub">{label(k)}</h3>
                <ul className="inv-pi-list">
                  {Object.entries(data[k] || {}).map(([name, n]) => <li key={name}><span>{t(`inventory.pi.${ns}.${name}`)}</span><strong>{n}</strong></li>)}
                  {Object.keys(data[k] || {}).length === 0 && <li className="cc-na">{t('wmsfloor.common.na')}</li>}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
      <SectionCard title={label('byEmployee')}>
        <ul className="inv-pi-list">
          {(data?.by_employee || []).map((e) => <li key={e.user_id}><span>{e.full_name || e.user_id}</span><strong>{e.identified} / {e.captures}</strong></li>)}
          {!data?.by_employee?.length && <li className="cc-na">{t('inventory.pi.dash.noCaptures')}</li>}
        </ul>
      </SectionCard>
      <SectionCard title={label('byLocation')}>
        <ul className="inv-pi-list">
          {(data?.by_location || []).map((l) => <li key={`${l.site}-${l.location}`}><span>{l.site} / {l.location}</span><strong>{l.captures} ({t('inventory.pi.dash.pendingN', { n: l.pending })})</strong></li>)}
          {!data?.by_location?.length && <li className="cc-na">{t('inventory.pi.dash.noCaptures')}</li>}
        </ul>
      </SectionCard>
    </div>
  )
}

export default function PhysicalInventorySection({ scope, can, userId, tab: linkedTab, onTab, onNavigate }) {
  const { t } = useLanguage()
  const { profile } = useAuth()
  // null: uploadPhoto resolves the company from the database (app_current_org); the
  // profile select in AuthContext does not load organisation_id.
  const orgId = profile?.organisation_id || profile?.org_id || null
  const [tab, setTab] = useHubTab(linkedTab, onTab, TABS, 'capture')
  const tabs = useMemo(() => TABS.map((k) => ({ key: k, label: t(`inventory.pi.tabs.${k}`) })), [t])
  return (
    <div className="inv-hub">
      <Note title={t('inventory.pi.title')}>{t('inventory.pi.lead')}</Note>
      <Tabs variant="line" label={t('inventory.pi.title')} value={tab} tabs={tabs} onChange={setTab} />
      {tab === 'capture' && <CaptureTab scope={scope} orgId={orgId} t={t} onNavigate={onNavigate} />}
      {tab === 'dashboard' && <DashboardTab scope={scope} t={t} can={can} />}
      {['review', 'materials', 'search'].includes(tab) && (
        <Suspense fallback={<div className="cc-skel" style={{ height: 120 }} />}>
          <PhysicalInventoryReview view={tab} scope={scope} can={can} userId={userId} orgId={orgId} />
        </Suspense>
      )}
    </div>
  )
}
