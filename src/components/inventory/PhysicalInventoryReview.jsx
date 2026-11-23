/**
 * Physical inventory - the review side:
 *   review       unidentified / proposed captures -> map to an approved material,
 *                create a new one, or reject (never by the person who counted)
 *   materials    company materials and variants waiting for approval, ERP SKU links
 *   corrections  master-data correction centre (old vs new, evidence, history)
 *   search       one company-wide search with genuine / OES / aftermarket separated
 *                and authorised availability per store (+ transfer request)
 * Every decision is enforced in the database; the screen shows the refusal.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, X, Link2, Search, Truck, Image as ImageIcon, FileWarning } from 'lucide-react'
import { Pager } from '../commandCenter/kit'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { newIdempotencyKey, searchItems } from '../../lib/api/inventory'
import {
  listCaptures, mapCapture, listMaterials, listVariants, decideMaterial, decideMaterialsBulk, decideVariant, linkErpItem, searchMaterials,
  listCorrections, listCorrectionHistory, requestCorrection, decideCorrection, requestTransfer, listPhotos, proposeVariant,
  listTransferRequests, decideTransferRequest,
} from '../../lib/api/physicalInventory'
import {
  CLASSIFICATIONS, CORRECTABLE_FIELDS, REFERENCE_TYPES, groupVariants, sumAvailability, transferSources, correctionDiff,
  identificationTone, classificationTone, topicForField, transferActions,
} from '../../lib/inventory/physicalInventory'
import { toUserMessage } from '../../lib/inventory/errorText'
import { useInvQuery, ErrorNote, NotSetUp, Note, Field, SectionCard, StatusPill, PagedTable, SearchBox, fmtDateTime } from './InvUi'

const evidenceList = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean).map((ref) => ({ type: 'note', ref }))

function useAction() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const run = async (fn, okText) => {
    setBusy(true); setMsg(null)
    try { await fn(newIdempotencyKey()); setMsg({ tone: 'good', text: okText }); return true } catch (x) { setMsg({ tone: 'bad', text: toUserMessage(x) }); return false } finally { setBusy(false) }
  }
  return { busy, msg, run, setMsg }
}

function Photos({ captureId, canonicalId, t }) {
  const [open, setOpen] = useState(null)
  const q = useInvQuery(() => listPhotos({ captureId, canonicalId }), [captureId, canonicalId])
  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  const rows = q.data || []
  if (!rows.length) return <p className="cc-na">{t('inventory.pi.review.noPhotos')}</p>
  return (
    <>
      <div className="inv-pi-photos">
        {rows.map((p) => (
          <button key={p.id} type="button" onClick={() => setOpen(p)} aria-label={`${t(`inventory.pi.photoRole.${p.photo_role}`)} - ${t(`inventory.pi.purpose.${p.purpose}`)}`}>
            {p.thumbUrl || p.url ? <img src={p.thumbUrl || p.url} alt={t(`inventory.pi.photoRole.${p.photo_role}`)} loading="lazy" /> : <span className="cc-na">N/A</span>}
          </button>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${t(`inventory.pi.photoRole.${open.photo_role}`)} - ${t(`inventory.pi.purpose.${open.purpose}`)}` : ''} size="lg">
        {open?.url ? <img className="inv-pi-full" src={open.url} alt={t(`inventory.pi.photoRole.${open.photo_role}`)} /> : <p className="cc-na">{t('inventory.pi.review.photoUnavailable')}</p>}
        {open && <p className="cc-na">{fmtDateTime(open.uploaded_at)}</p>}
      </Modal>
    </>
  )
}

function MaterialPicker({ onPick, t, placeholder }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  const find = async () => { setErr(''); try { setRes(await searchMaterials(q)) } catch (x) { setErr(toUserMessage(x)) } }
  return (
    <div className="inv-hub" style={{ gap: 8 }}>
      <div className="cc-filters">
        <SearchBox value={q} onChange={setQ} placeholder={placeholder || t('inventory.pi.search.placeholder')} />
        <button type="button" className="cc-btn" onClick={find} disabled={q.trim().length < 2}><Search size={14} aria-hidden="true" /> {t('inventory.pi.capture.find')}</button>
      </div>
      {err && <ErrorNote error={err} />}
      {res?.results?.length === 0 && <Note>{t('inventory.pi.capture.noMatch')}</Note>}
      <ul className="inv-picklist">
        {(res?.results || []).filter((r) => r.status === 'active').flatMap((r) => [
          <li key={r.canonical_id}><button type="button" onClick={() => onPick({ canonicalId: r.canonical_id, variantId: null, label: r.description, result: r })}>{r.description} {r.company_sku ? `(${r.company_sku})` : ''}</button></li>,
          ...(r.variants || []).filter((v) => v.status === 'active').map((v) => (
            <li key={v.variant_id}><button type="button" onClick={() => onPick({ canonicalId: r.canonical_id, variantId: v.variant_id, label: `${r.description} / ${v.manufacturer || ''} ${v.part_number || ''}`, result: r })}>
              &nbsp;&nbsp;{t(`inventory.pi.cls.${v.classification}`)}: {v.manufacturer || ''} {v.part_number || ''}</button></li>
          )),
        ])}
      </ul>
    </div>
  )
}

function ReviewDrawer({ capture, onClose, onDone, t }) {
  const [mode, setMode] = useState('map_existing')
  const [pick, setPick] = useState(null)
  const [canon, setCanon] = useState({ description: capture?.entered_refs?.description || '', company_sku: capture?.entered_refs?.company_sku || '', category: '', base_uom: capture?.uom || '', manufacturer: capture?.entered_refs?.manufacturer || '', brand: capture?.entered_refs?.brand || '' })
  const [variant, setVariant] = useState({ manufacturer: capture?.entered_refs?.manufacturer || '', part_number: capture?.entered_refs?.aftermarket || capture?.entered_refs?.oem || '', part_classification: 'unknown', country_of_manufacture: '', evidence: '' })
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const a = useAction()
  if (!capture) return null
  const dups = capture.duplicate_candidates || []
  const submit = () => a.run((key) => mapCapture({
    captureId: capture.id, decision: mode, canonicalId: pick?.canonicalId, variantId: pick?.variantId,
    canonical: mode === 'create_new' ? canon : undefined,
    variant: mode === 'create_new' && (variant.part_number || variant.manufacturer)
      ? { ...variant, evidence: evidenceList(variant.evidence) } : undefined,
    notDuplicateReason: reason, note,
  }, key), t('inventory.pi.review.done')).then((ok) => ok && onDone())
  return (
    <Modal open onClose={onClose} size="lg" title={capture.temp_ref || capture.scanned_code || t('inventory.pi.review.capture')}
      subtitle={`${capture.site} / ${capture.location_code || capture.location_hint || '-'} / ${capture.captured_by_name || ''} / ${fmtDateTime(capture.captured_at)}`}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-primary" disabled={a.busy || (mode === 'map_existing' && !pick) || (mode === 'reject' && !note.trim())} onClick={submit}><Check size={14} aria-hidden="true" /> {t(`inventory.pi.review.do.${mode}`)}</button>
          <button type="button" className="cc-btn-ghost" onClick={onClose}>{t('inventory.actions.cancel')}</button>
        </div>
      )}>
      <div className="inv-hub" style={{ gap: 12 }}>
        <dl className="inv-dl">
          <dt>{t('inventory.pi.common.qty')}</dt><dd>{capture.quantity} {capture.uom || ''}</dd>
          <dt>{t('inventory.pi.common.condition')}</dt><dd>{t(`inventory.pi.cond.${capture.condition}`)}</dd>
          <dt>{t('inventory.pi.common.ownership')}</dt><dd>{t(`inventory.pi.own.${capture.ownership}`)}</dd>
          <dt>{t('inventory.pi.review.entered')}</dt><dd>{Object.entries(capture.entered_refs || {}).map(([k, v]) => `${t(`inventory.pi.ref.${k}`)}: ${v}`).join(' / ') || 'N/A'}</dd>
          <dt>{t('inventory.pi.common.remarks')}</dt><dd>{capture.remarks || 'N/A'}</dd>
        </dl>
        <Photos captureId={capture.id} t={t} />
        {dups.length > 0 && (
          <Note tone="warn" title={t('inventory.pi.review.duplicates', { n: dups.length })}>
            {dups.map((d) => `${d.description || d.erp_sku}${d.company_sku ? ` (${d.company_sku})` : ''} - ${(d.reasons || []).join(', ')}`).join('; ')}
          </Note>
        )}
        <div className="cc-filters" role="radiogroup" aria-label={t('inventory.pi.review.decision')}>
          {['map_existing', 'create_new', 'reject'].map((m) => (
            <label key={m} className="inv-check"><input type="radio" name="pi-mode" checked={mode === m} onChange={() => setMode(m)} /> {t(`inventory.pi.review.mode.${m}`)}</label>
          ))}
        </div>
        {mode === 'map_existing' && (pick ? <Note tone="good" action={<button type="button" className="cc-btn-ghost" onClick={() => setPick(null)}>{t('inventory.pi.capture.clearPick')}</button>}>{pick.label}</Note> : <MaterialPicker t={t} onPick={setPick} />)}
        {mode === 'create_new' && (
          <div className="inv-form">
            {['description', 'company_sku', 'category', 'base_uom', 'manufacturer', 'brand'].map((k) => (
              <Field key={k} label={t(`inventory.pi.field.${k}`)} full={k === 'description'}><input className="inv-input" value={canon[k]} onChange={(e) => setCanon((c) => ({ ...c, [k]: e.target.value }))} /></Field>
            ))}
            <Field label={t('inventory.pi.field.variant_manufacturer')}><input className="inv-input" value={variant.manufacturer} onChange={(e) => setVariant((v) => ({ ...v, manufacturer: e.target.value }))} /></Field>
            <Field label={t('inventory.pi.field.part_number')}><input className="inv-input" value={variant.part_number} onChange={(e) => setVariant((v) => ({ ...v, part_number: e.target.value }))} /></Field>
            <Field label={t('inventory.pi.field.part_classification')}>
              <select className="cc-select" value={variant.part_classification} onChange={(e) => setVariant((v) => ({ ...v, part_classification: e.target.value }))}>
                {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{t(`inventory.pi.cls.${c}`)}</option>)}
              </select>
            </Field>
            <Field label={t('inventory.pi.field.country_of_manufacture')}><input className="inv-input" value={variant.country_of_manufacture} onChange={(e) => setVariant((v) => ({ ...v, country_of_manufacture: e.target.value }))} /></Field>
            <Field label={t('inventory.pi.field.evidence')} full><textarea className="inv-input" rows={2} value={variant.evidence} onChange={(e) => setVariant((v) => ({ ...v, evidence: e.target.value }))} /></Field>
            <Note>{t('inventory.pi.rules.genuine')}</Note>
            {dups.length > 0 && <Field label={t('inventory.pi.review.notDuplicate')} full><input className="inv-input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
          </div>
        )}
        <Field label={t('inventory.pi.common.note')} full><input className="inv-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
        {a.msg && <Note tone={a.msg.tone}>{a.msg.text}</Note>}
        <Note>{t('inventory.pi.rules.reviewer')}</Note>
      </div>
    </Modal>
  )
}

function ReviewView({ scope, t }) {
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(25)
  const [status, setStatus] = useState('pending_review')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(null)
  const [stamp, setStamp] = useState(0)
  const q = useInvQuery(() => listCaptures({ page, pageSize: size, status, site: scope.site, country: scope.country, search }), [page, size, status, scope.site, scope.country, search, stamp])
  const cols = [
    { key: 'temp_ref', header: t('inventory.pi.common.ref'), cell: (r) => r.temp_ref || r.scanned_code || 'N/A' },
    { key: 'what', header: t('inventory.pi.common.material'), cell: (r) => r.canonical_description || r.entered_refs?.description || 'N/A' },
    { key: 'site', header: t('inventory.scope.site') },
    { key: 'quantity', header: t('inventory.pi.common.qty'), numeric: true },
    { key: 'dups', header: t('inventory.pi.review.dupCol'), cell: (r) => (r.duplicate_candidates?.length ? <StatusPill value="dup" tone="warn" label={String(r.duplicate_candidates.length)} /> : '-') },
    { key: 'identification_status', header: t('inventory.pi.common.status'), cell: (r) => <StatusPill value={r.identification_status} tone={identificationTone(r.identification_status)} label={t(`inventory.pi.status.${r.identification_status}`)} /> },
    { key: 'captured_by_name', header: t('inventory.pi.common.by') },
    { key: 'photo_count', header: t('inventory.pi.common.photos'), numeric: true },
  ]
  return (
    <SectionCard title={t('inventory.pi.review.title')} sub={t('inventory.pi.review.sub')}>
      <div className="cc-filters">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }} placeholder={t('inventory.pi.review.searchPlaceholder')} />
        <select className="cc-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }} aria-label={t('inventory.pi.common.status')}>
          {['pending_review', 'identified', 'mapped', 'rejected', 'all'].map((s) => <option key={s} value={s}>{t(`inventory.pi.status.${s}`)}</option>)}
        </select>
      </div>
      <PagedTable query={q} columns={cols} page={page} pageSize={size} onPage={setPage} onPageSize={(s) => { setSize(s); setPage(0) }}
        empty={t('inventory.pi.review.empty')} what={t('inventory.pi.title')} noun={t('inventory.pi.common.captures')}
        onRowClick={(r) => setOpen(r)} />
      {open && (open.identification_status === 'pending_review'
        ? <ReviewDrawer capture={open} t={t} onClose={() => setOpen(null)} onDone={() => { setOpen(null); setStamp((s) => s + 1) }} />
        : (
          <Modal open onClose={() => setOpen(null)} title={open.canonical_description || open.temp_ref} size="md">
            <Photos captureId={open.id} t={t} />
            <p>{t(`inventory.pi.status.${open.identification_status}`)} {open.mapping_note ? `- ${open.mapping_note}` : ''}</p>
          </Modal>
        ))}
    </SectionCard>
  )
}

function DecideRow({ onApprove, onReject, needsReason, t, busy }) {
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  return (
    <div className="inv-actions">
      {needsReason && <input className="inv-input" placeholder={t('inventory.pi.review.notDuplicate')} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('inventory.pi.review.notDuplicate')} />}
      <input className="inv-input" placeholder={t('inventory.pi.common.note')} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('inventory.pi.common.note')} />
      <button type="button" className="cc-btn" disabled={busy} onClick={() => onApprove(note, reason)}><Check size={14} aria-hidden="true" /> {t('inventory.pi.actions.approve')}</button>
      <button type="button" className="cc-btn-ghost" disabled={busy || !note.trim()} onClick={() => onReject(note)}><X size={14} aria-hidden="true" /> {t('inventory.pi.actions.reject')}</button>
    </div>
  )
}

const BULK_SIZE = 500

/** Approve many proposals per press. The server applies the single-item rules to each one and reports what it skipped. */
function BulkApprove({ t, onDone }) {
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const run = async () => {
    if (!window.confirm(t('inventory.pi.materials.bulkConfirm', { n: BULK_SIZE }))) return
    setBusy(true); setError(''); setResult(null)
    try {
      const r = await decideMaterialsBulk({ decision: 'approve', search, limit: BULK_SIZE, notDuplicateReason: reason })
      setResult(r)
      onDone()
    } catch (x) { setError(toUserMessage(x)) } finally { setBusy(false) }
  }
  return (
    <SectionCard title={t('inventory.pi.materials.bulkTitle')} sub={t('inventory.pi.materials.bulkSub')}>
      <div className="inv-actions">
        <input className="inv-input" placeholder={t('inventory.pi.materials.bulkFilter')} aria-label={t('inventory.pi.materials.bulkFilter')}
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <input className="inv-input" placeholder={t('inventory.pi.materials.bulkReason')} aria-label={t('inventory.pi.materials.bulkReason')}
          value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="button" className="cc-btn" disabled={busy} onClick={run}>
          <Check size={14} aria-hidden="true" /> {t('inventory.pi.materials.bulkApprove', { n: BULK_SIZE })}
        </button>
      </div>
      {error && <Note tone="bad">{error}</Note>}
      {result && (
        <Note tone={result.skipped ? 'warn' : 'good'}>
          {t('inventory.pi.materials.bulkResult', { done: result.done, skipped: result.skipped, remaining: result.remaining_proposed })}
          {result.skipped_detail?.[0]?.reason ? ` ${t('inventory.pi.materials.bulkSkipReason', { reason: result.skipped_detail[0].reason })}` : ''}
        </Note>
      )}
    </SectionCard>
  )
}

function MaterialsView({ scope, t }) {
  const [stamp, setStamp] = useState(0)
  const mats = useInvQuery(() => listMaterials({ status: 'proposed', pageSize: 50 }), [stamp])
  const vars = useInvQuery(() => listVariants({ status: 'proposed', pageSize: 50 }), [stamp])
  const a = useAction()
  const [link, setLink] = useState({ pick: null, term: '', hits: [], item: null })
  const [vDraft, setVDraft] = useState({ pick: null, manufacturer: '', brand: '', part_number: '', part_classification: 'unknown', country_of_manufacture: '', evidence: '' })
  useEffect(() => {
    let live = true
    if (link.term.trim().length < 2) return undefined
    const h = setTimeout(() => searchItems(link.term, { country: scope.country }).then((r) => { if (live) setLink((l) => ({ ...l, hits: r })) }).catch(() => {}), 300)
    return () => { live = false; clearTimeout(h) }
  }, [link.term, scope.country])
  const refresh = () => setStamp((s) => s + 1)
  if (mats.data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.pi.title')} />
  return (
    <div className="inv-hub">
      <BulkApprove t={t} onDone={refresh} />
      <SectionCard title={t('inventory.pi.materials.title')} sub={t('inventory.pi.materials.sub')}>
        {mats.error && <ErrorNote error={mats.error} onRetry={mats.retry} />}
        {(mats.data?.rows || []).length === 0 && !mats.loading && <p className="cc-na">{t('inventory.pi.materials.empty')}</p>}
        {(mats.data?.rows || []).map((m) => (
          <div key={m.id} className="inv-pi-result">
            <div><strong>{m.description}</strong> <span className="cc-na">{m.company_sku || t('inventory.pi.common.noCompanySku')} / {m.proposed_from_site || ''} / {fmtDateTime(m.proposed_at)}</span></div>
            {m.duplicate_candidates?.length > 0 && <Note tone="warn">{t('inventory.pi.review.duplicates', { n: m.duplicate_candidates.length })}: {m.duplicate_candidates.map((d) => d.description || d.erp_sku).join('; ')}</Note>}
            <Photos canonicalId={m.id} t={t} />
            <DecideRow t={t} busy={a.busy} needsReason={m.duplicate_candidates?.length > 0}
              onApprove={(note, reason) => a.run((k) => decideMaterial({ canonicalId: m.id, decision: 'approve', note, notDuplicateReason: reason }, k), t('inventory.pi.review.done')).then(refresh)}
              onReject={(note) => a.run((k) => decideMaterial({ canonicalId: m.id, decision: 'reject', note }, k), t('inventory.pi.review.done')).then(refresh)} />
          </div>
        ))}
      </SectionCard>
      <SectionCard title={t('inventory.pi.materials.variantsTitle')} sub={t('inventory.pi.rules.genuine')}>
        {vars.error && <ErrorNote error={vars.error} onRetry={vars.retry} />}
        {(vars.data?.rows || []).length === 0 && !vars.loading && <p className="cc-na">{t('inventory.pi.materials.empty')}</p>}
        {(vars.data?.rows || []).map((v) => (
          <div key={v.id} className="inv-pi-result">
            <div><StatusPill value={v.part_classification} tone={classificationTone(v.part_classification)} label={t(`inventory.pi.cls.${v.part_classification}`)} /> <strong>{v.manufacturer || ''} {v.part_number || ''}</strong> <span className="cc-na">{t('inventory.pi.materials.evidenceN', { n: (v.classification_evidence || []).length })}</span></div>
            <DecideRow t={t} busy={a.busy}
              onApprove={(note) => a.run((k) => decideVariant({ variantId: v.id, decision: 'approve', note }, k), t('inventory.pi.review.done')).then(refresh)}
              onReject={(note) => a.run((k) => decideVariant({ variantId: v.id, decision: 'reject', note }, k), t('inventory.pi.review.done')).then(refresh)} />
          </div>
        ))}
      </SectionCard>
      <SectionCard title={t('inventory.pi.materials.addVariantTitle')} sub={t('inventory.pi.materials.addVariantSub')}>
        {vDraft.pick ? <Note tone="good" action={<button type="button" className="cc-btn-ghost" onClick={() => setVDraft((d) => ({ ...d, pick: null }))}>{t('inventory.pi.capture.clearPick')}</button>}>{vDraft.pick.label}</Note>
          : <MaterialPicker t={t} onPick={(p) => setVDraft((d) => ({ ...d, pick: p }))} />}
        <div className="inv-form">
          {['manufacturer', 'brand', 'part_number', 'country_of_manufacture'].map((k) => (
            <Field key={k} label={t(`inventory.pi.field.${k}`)}><input className="inv-input" value={vDraft[k]} onChange={(e) => setVDraft((d) => ({ ...d, [k]: e.target.value }))} /></Field>
          ))}
          <Field label={t('inventory.pi.field.part_classification')}>
            <select className="cc-select" value={vDraft.part_classification} onChange={(e) => setVDraft((d) => ({ ...d, part_classification: e.target.value }))}>
              {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{t(`inventory.pi.cls.${c}`)}</option>)}
            </select>
          </Field>
          <Field label={t('inventory.pi.field.evidence')} full><textarea className="inv-input" rows={2} value={vDraft.evidence} onChange={(e) => setVDraft((d) => ({ ...d, evidence: e.target.value }))} /></Field>
        </div>
        <button type="button" className="cc-btn" disabled={a.busy || !vDraft.pick} onClick={() => a.run((k) => proposeVariant({
          canonical_id: vDraft.pick.canonicalId, manufacturer: vDraft.manufacturer, brand: vDraft.brand, part_number: vDraft.part_number,
          part_classification: vDraft.part_classification, country_of_manufacture: vDraft.country_of_manufacture, evidence: evidenceList(vDraft.evidence),
        }, k), t('inventory.pi.materials.variantProposed')).then(refresh)}>{t('inventory.pi.materials.proposeVariant')}</button>
      </SectionCard>
      <SectionCard title={t('inventory.pi.materials.linkTitle')} sub={t('inventory.pi.materials.linkSub')}>
        {link.pick ? <Note tone="good" action={<button type="button" className="cc-btn-ghost" onClick={() => setLink((l) => ({ ...l, pick: null }))}>{t('inventory.pi.capture.clearPick')}</button>}>{link.pick.label}</Note>
          : <MaterialPicker t={t} onPick={(p) => setLink((l) => ({ ...l, pick: p }))} />}
        <Field label={t('inventory.pi.materials.erpSku')}><input className="inv-input" value={link.term} onChange={(e) => setLink((l) => ({ ...l, term: e.target.value, item: null }))} /></Field>
        <ul className="inv-picklist">
          {link.hits.map((h) => <li key={h.id}><button type="button" onClick={() => setLink((l) => ({ ...l, item: h, term: `${h.item_code} ${h.item_name || ''}`, hits: [] }))}>{h.item_code} - {h.item_name} ({h.country})</button></li>)}
        </ul>
        <button type="button" className="cc-btn" disabled={a.busy || !link.pick || !link.item} onClick={() => a.run((k) => linkErpItem({ itemId: link.item.id, canonicalId: link.pick.canonicalId, variantId: link.pick.variantId }, k), t('inventory.pi.materials.linked'))}>
          <Link2 size={14} aria-hidden="true" /> {t('inventory.pi.materials.link')}
        </button>
      </SectionCard>
      {a.msg && <Note tone={a.msg.tone}>{a.msg.text}</Note>}
    </div>
  )
}

function CorrectionDetail({ row, onClose, onDone, userId, t }) {
  const a = useAction()
  const [note, setNote] = useState('')
  const hist = useInvQuery(() => listCorrectionHistory(row.id), [row.id])
  const diff = correctionDiff(row.old_value, row.new_value)
  const own = row.requested_by === userId
  return (
    <Modal open onClose={onClose} size="lg" title={t(`inventory.pi.topic.${row.topic}`)} subtitle={`${t(`inventory.pi.corr.action.${row.action}`)} / ${fmtDateTime(row.requested_at)}`}
      footer={row.status === 'submitted' && (
        <div className="inv-actions">
          {!own && <button type="button" className="cc-btn-primary" disabled={a.busy} onClick={() => a.run((k) => decideCorrection({ requestId: row.id, decision: 'approve', note }, k), t('inventory.pi.review.done')).then((ok) => ok && onDone())}><Check size={14} aria-hidden="true" /> {t('inventory.pi.actions.approve')}</button>}
          {!own && <button type="button" className="cc-btn-ghost" disabled={a.busy || !note.trim()} onClick={() => a.run((k) => decideCorrection({ requestId: row.id, decision: 'reject', note }, k), t('inventory.pi.review.done')).then((ok) => ok && onDone())}><X size={14} aria-hidden="true" /> {t('inventory.pi.actions.reject')}</button>}
          {own && <button type="button" className="cc-btn-ghost" disabled={a.busy} onClick={() => a.run((k) => decideCorrection({ requestId: row.id, decision: 'cancel' }, k), t('inventory.pi.review.done')).then((ok) => ok && onDone())}>{t('inventory.pi.corr.cancel')}</button>}
        </div>
      )}>
      <div className="inv-hub" style={{ gap: 12 }}>
        <table className="inv-pi-diff">
          <thead><tr><th>{t('inventory.pi.corr.field')}</th><th>{t('inventory.pi.corr.before')}</th><th>{t('inventory.pi.corr.after')}</th></tr></thead>
          <tbody>
            {diff.map((d) => <tr key={d.field} className={d.changed ? 'changed' : ''}><td>{d.field}</td><td>{d.before == null ? 'N/A' : JSON.stringify(d.before)}</td><td>{d.after == null ? 'N/A' : JSON.stringify(d.after)}</td></tr>)}
          </tbody>
        </table>
        <p><strong>{t('inventory.pi.corr.reason')}:</strong> {row.reason}</p>
        <p><strong>{t('inventory.pi.field.evidence')}:</strong> {(row.evidence || []).map((e) => e.ref || JSON.stringify(e)).join('; ') || 'N/A'}</p>
        {own && row.status === 'submitted' && <Note>{t('inventory.pi.corr.ownNote')}</Note>}
        {row.status === 'submitted' && <Field label={t('inventory.pi.common.note')} full><input className="inv-input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
        <h3 className="cc-card-sub">{t('inventory.pi.corr.history')}</h3>
        <ul className="inv-pi-list">{(hist.data || []).map((h) => <li key={h.id}><span>{t(`inventory.pi.corr.event.${h.event}`)}</span><strong>{fmtDateTime(h.at)}</strong></li>)}</ul>
        {a.msg && <Note tone={a.msg.tone}>{a.msg.text}</Note>}
      </div>
    </Modal>
  )
}

/**
 * Correction rows in the Control Center look: what is wrong, who asked and
 * when, the status and a Review button. Reviewing opens the detail where the
 * database decides (a requester can never approve their own request).
 */
export function CorrectionRows({ query, t, onReview, empty }) {
  if (query.error) return <ErrorNote error={query.error} onRetry={query.retry} />
  if (query.data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.pi.title')} />
  if (query.loading && !query.data) return <div className="cc-skel" style={{ height: 96 }} aria-busy="true" />
  const rows = query.data?.rows || []
  if (!rows.length) return <p className="cc-na">{empty || t('inventory.pi.corr.empty')}</p>
  return (
    <ul className="inv-corr-list">
      {rows.map((r) => (
        <li key={r.id} className="inv-corr-row">
          <span className="inv-corr-icon" aria-hidden="true"><FileWarning size={16} /></span>
          <span className="inv-corr-text">
            <b>{t(`inventory.pi.topic.${r.topic}`)}</b>
            <small>{t(`inventory.pi.corr.action.${r.action}`)}{r.reason ? ` · ${r.reason}` : ''}</small>
            <small>{t('inventory.ui.corrections.requested', { when: fmtDateTime(r.requested_at) })}</small>
          </span>
          <StatusPill value={r.status} tone={r.status === 'submitted' ? 'warn' : r.status === 'approved' ? 'good' : 'muted'} label={t(`inventory.pi.corr.status.${r.status}`)} />
          <button type="button" className="inv-btn-review" onClick={() => onReview(r)}>{t('inventory.ui.corrections.review')}</button>
        </li>
      ))}
    </ul>
  )
}

/** Detail modal for one correction, reused by the Material Master panel. */
export { CorrectionDetail }

function CorrectionsView({ userId, t }) {
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(25)
  const [status, setStatus] = useState('submitted')
  const [open, setOpen] = useState(null)
  const [stamp, setStamp] = useState(0)
  const [draft, setDraft] = useState({ pick: null, kind: 'canonical', action: 'field_update', field: 'description', value: '', alias_type: 'oem', reason: '', evidence: '' })
  const a = useAction()
  const q = useInvQuery(() => listCorrections({ page, pageSize: size, status }), [page, size, status, stamp])
  const fields = CORRECTABLE_FIELDS[draft.kind]
  const target = draft.kind === 'variant' ? draft.pick?.variantId : draft.pick?.canonicalId
  const submit = () => {
    const base = { target_kind: draft.kind, target_id: target, action: draft.action, reason: draft.reason, evidence: evidenceList(draft.evidence) }
    const payload = draft.action === 'field_update'
      ? { ...base, topic: topicForField(draft.field), new_value: { [draft.field]: draft.value } }
      : draft.action === 'add_reference'
        ? { ...base, topic: draft.alias_type === 'company_sku' ? 'company_sku' : (draft.alias_type === 'aftermarket' ? 'aftermarket' : 'oem'), new_value: { alias_type: draft.alias_type, value: draft.value } }
        : { ...base, topic: 'duplicate', new_value: { keep_canonical_id: draft.keep?.canonicalId } }
    return a.run((k) => requestCorrection(payload, k), t('inventory.pi.corr.submitted')).then(() => setStamp((s) => s + 1))
  }
  return (
    <div className="inv-hub">
      <SectionCard
        title={status === 'submitted' && q.data?.status === 'ok' ? t('inventory.ui.corrections.titlePending', { n: q.data.total }) : t('inventory.pi.corr.title')}
        sub={t('inventory.pi.corr.sub')}
        action={(
          <select className="cc-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }} aria-label={t('inventory.pi.common.status')}>
            {['submitted', 'approved', 'rejected', 'cancelled', 'all'].map((s) => <option key={s} value={s}>{t(`inventory.pi.corr.status.${s}`)}</option>)}
          </select>
        )}>
        <CorrectionRows query={q} t={t} onReview={setOpen} />
        {(q.data?.total ?? 0) > size && (
          <Pager page={page} pageSize={size} total={q.data.total} onPage={setPage} onPageSize={(s) => { setSize(s); setPage(0) }} sizes={[25, 50, 100]} noun={t('inventory.pi.corr.noun')} />
        )}
        {open && <CorrectionDetail row={open} userId={userId} t={t} onClose={() => setOpen(null)} onDone={() => { setOpen(null); setStamp((s) => s + 1) }} />}
      </SectionCard>
      <SectionCard title={t('inventory.pi.corr.newTitle')} sub={t('inventory.pi.corr.newSub')}>
        {draft.pick ? <Note tone="good" action={<button type="button" className="cc-btn-ghost" onClick={() => setDraft((d) => ({ ...d, pick: null }))}>{t('inventory.pi.capture.clearPick')}</button>}>{draft.pick.label}</Note>
          : <MaterialPicker t={t} onPick={(p) => setDraft((d) => ({ ...d, pick: p, kind: p.variantId ? 'variant' : 'canonical', field: CORRECTABLE_FIELDS[p.variantId ? 'variant' : 'canonical'][0] }))} />}
        <div className="inv-form">
          <Field label={t('inventory.pi.corr.actionCol')}>
            <select className="cc-select" value={draft.action} onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}>
              {['field_update', 'add_reference', ...(draft.kind === 'canonical' ? ['duplicate'] : [])].map((x) => <option key={x} value={x}>{t(`inventory.pi.corr.action.${x}`)}</option>)}
            </select>
          </Field>
          {draft.action === 'field_update' && (
            <Field label={t('inventory.pi.corr.field')}>
              <select className="cc-select" value={draft.field} onChange={(e) => setDraft((d) => ({ ...d, field: e.target.value }))}>
                {fields.map((f) => <option key={f} value={f}>{t(`inventory.pi.field.${f}`)}</option>)}
              </select>
            </Field>
          )}
          {draft.action === 'add_reference' && (
            <Field label={t('inventory.pi.corr.refType')}>
              <select className="cc-select" value={draft.alias_type} onChange={(e) => setDraft((d) => ({ ...d, alias_type: e.target.value }))}>
                {REFERENCE_TYPES.map((r) => <option key={r} value={r}>{t(`inventory.pi.codeType.${r === 'alternative' || r === 'superseded' || r === 'erp_legacy' ? 'description' : r}`)} ({r})</option>)}
              </select>
            </Field>
          )}
          {draft.action !== 'duplicate'
            ? <Field label={t('inventory.pi.corr.newValue')}>
                {draft.field === 'part_classification' && draft.action === 'field_update'
                  ? <select className="cc-select" value={draft.value} onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}><option value="" />{CLASSIFICATIONS.map((c) => <option key={c} value={c}>{t(`inventory.pi.cls.${c}`)}</option>)}</select>
                  : <input className="inv-input" value={draft.value} onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))} />}
              </Field>
            : <div className="inv-full"><p className="cc-na">{t('inventory.pi.corr.keep')}</p>{draft.keep ? <Note tone="good">{draft.keep.label}</Note> : <MaterialPicker t={t} onPick={(p) => setDraft((d) => ({ ...d, keep: p }))} />}</div>}
          <Field label={t('inventory.pi.corr.reason')} full><input className="inv-input" value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} /></Field>
          <Field label={t('inventory.pi.field.evidence')} full><textarea className="inv-input" rows={2} value={draft.evidence} onChange={(e) => setDraft((d) => ({ ...d, evidence: e.target.value }))} /></Field>
        </div>
        <Note>{t('inventory.pi.rules.corrections')}</Note>
        <button type="button" className="cc-btn" disabled={a.busy || !target || draft.reason.trim().length < 3 || (draft.action !== 'duplicate' && !draft.value.trim()) || (draft.action === 'duplicate' && !draft.keep)} onClick={submit}>{t('inventory.pi.corr.submit')}</button>
        {a.msg && <Note tone={a.msg.tone}>{a.msg.text}</Note>}
      </SectionCard>
    </div>
  )
}

function Availability({ rows, t }) {
  const s = sumAvailability(rows)
  if (!s) return <span className="cc-na">{t('inventory.pi.search.noStock')}</span>
  return (
    <div className="inv-pi-avail">
      {rows.map((r) => (
        <div key={r.site}><strong>{r.site}</strong>: {t('inventory.pi.search.avail', { a: r.available, r: r.reserved, it: r.in_transit, d: r.damaged, q: r.quarantined })}</div>
      ))}
    </div>
  )
}

function SearchView({ scope, t }) {
  const [term, setTerm] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tr, setTr] = useState(null)
  const a = useAction()
  const run = async (e) => {
    e?.preventDefault()
    setBusy(true); setErr('')
    try { setRes(await searchMaterials(term, { limit: 30 })) } catch (x) { setErr(toUserMessage(x)) } finally { setBusy(false) }
  }
  const here = scope.site && scope.site !== 'all' ? scope.site : ''
  return (
    <SectionCard title={t('inventory.pi.search.title')} sub={t('inventory.pi.search.sub')}>
      <form className="cc-filters" onSubmit={run}>
        <SearchBox value={term} onChange={setTerm} placeholder={t('inventory.pi.search.placeholder')} />
        <button type="submit" className="cc-btn-primary" disabled={busy || term.trim().length < 2}><Search size={14} aria-hidden="true" /> {busy ? t('inventory.actions.searching') : t('inventory.pi.capture.find')}</button>
      </form>
      {err && <ErrorNote error={err} />}
      {res?.status === 'not_provisioned' && <NotSetUp what={t('inventory.pi.title')} />}
      {res?.status === 'ok' && res.results.length === 0 && <Note>{t('inventory.pi.capture.noMatch')}</Note>}
      <div className="inv-pi-results">
        {(res?.results || []).map((r) => {
          const g = groupVariants(r)
          const sources = transferSources(r, here)
          return (
            <div key={r.canonical_id} className="inv-pi-result">
              <div>
                <strong>{r.description}</strong> <span className="cc-na">{r.company_sku || t('inventory.pi.common.noCompanySku')}</span>
                {r.status !== 'active' && <StatusPill value={r.status} tone="warn" label={t(`inventory.pi.status.${r.status}`)} />}
                <span className="cc-na"> / {t('inventory.pi.search.matchedOn')}: {(r.matched_on || []).join(', ')}</span>
              </div>
              <div className="cc-na">{t('inventory.pi.search.erp')}: {(r.erp_skus || []).map((e) => `${e.item_code} (${e.country})`).join(', ') || 'N/A'} / {t('inventory.pi.search.refs')}: {(r.references || []).map((x) => `${x.type}: ${x.value}${x.status === 'historical' ? ` (${t('inventory.pi.search.historical')})` : ''}`).join(', ') || 'N/A'}</div>
              {['genuine', 'oes', 'aftermarket', 'unknown'].map((k) => g[k].length > 0 && (
                <div key={k}>
                  <h3 className="cc-card-sub"><StatusPill value={k} tone={classificationTone(k)} label={t(`inventory.pi.cls.${k}`)} /></h3>
                  {g[k].map((v) => (
                    <div key={v.variant_id} style={{ marginBlock: 6 }}>
                      <div>{v.manufacturer || ''} {v.part_number || ''} {v.country_of_manufacture ? `(${v.country_of_manufacture})` : ''} {v.status !== 'active' && <StatusPill value={v.status} tone="warn" label={t(`inventory.pi.status.${v.status}`)} />}</div>
                      <Availability rows={v.availability || []} t={t} />
                    </div>
                  ))}
                </div>
              ))}
              {(r.availability_unassigned || []).length > 0 && <div><h3 className="cc-card-sub">{t('inventory.pi.search.unassigned')}</h3><Availability rows={r.availability_unassigned} t={t} /></div>}
              {sources.length > 0 && here && (r.erp_skus || []).length > 0 && (
                <div className="inv-actions">
                  {sources.map((s) => (
                    <button key={s.site} type="button" className="cc-btn" onClick={() => setTr({ result: r, fromSite: s.site, qty: '', reason: '' })}>
                      <Truck size={14} aria-hidden="true" /> {t('inventory.pi.search.requestFrom', { site: s.site, n: s.available })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <Modal open={!!tr} onClose={() => setTr(null)} title={t('inventory.pi.search.transferTitle')} size="sm"
        footer={tr && (
          <button type="button" className="cc-btn-primary" disabled={a.busy || !(Number(tr.qty) > 0) || !tr.reason.trim()}
            onClick={() => a.run((k) => requestTransfer({ itemId: (tr.result.erp_skus.find((e) => e.country === scope.country) || tr.result.erp_skus[0]).item_id, site: here, fromSite: tr.fromSite, qty: Number(tr.qty), reason: tr.reason }, k), t('inventory.pi.search.transferSent')).then((ok) => ok && setTr(null))}>
            {t('inventory.pi.search.sendRequest')}
          </button>
        )}>
        {tr && (
          <div className="inv-form">
            <p className="inv-full">{tr.result.description}: {tr.fromSite} &rarr; {here}</p>
            <Field label={t('inventory.pi.common.qty')}><input className="inv-input" inputMode="decimal" value={tr.qty} onChange={(e) => setTr((x) => ({ ...x, qty: e.target.value }))} /></Field>
            <Field label={t('inventory.pi.corr.reason')} full><input className="inv-input" value={tr.reason} onChange={(e) => setTr((x) => ({ ...x, reason: e.target.value }))} /></Field>
            {a.msg && <Note tone={a.msg.tone}>{a.msg.text}</Note>}
          </div>
        )}
      </Modal>
      {!here && <Note>{t('inventory.pi.search.pickStore')}</Note>}
    </SectionCard>
  )
}

function TransferRequestRow({ row, userId, onDone, t }) {
  const a = useAction()
  const [note, setNote] = useState('')
  const act = transferActions(row, userId)
  const decide = (decision) => a.run((k) => decideTransferRequest({ requestId: row.id, decision, note }, k), t('inventory.pi.transfers.done')).then((ok) => ok && onDone())
  return (
    <div className="inv-pi-result">
      <div>
        <strong>{row.item?.item_code || 'N/A'}</strong> {row.item?.item_name || ''} <span className="cc-na">{row.qty} / {row.from_site} &rarr; {row.site} / {fmtDateTime(row.requested_at)}</span>
        {' '}<StatusPill value={row.status} tone={row.status === 'requested' ? 'warn' : row.status === 'approved' ? 'good' : 'muted'} label={t(`inventory.pi.transfers.status.${row.status}`)} />
      </div>
      <div className="cc-na">{t('inventory.pi.corr.reason')}: {row.reason}{row.decision_note ? ` / ${row.decision_note}` : ''}</div>
      {(act.decide || act.cancel) && (
        <div className="inv-actions">
          {act.decide && <input className="inv-input" placeholder={t('inventory.pi.common.note')} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('inventory.pi.common.note')} />}
          {act.decide && <button type="button" className="cc-btn" disabled={a.busy} onClick={() => decide('approve')}><Check size={14} aria-hidden="true" /> {t('inventory.pi.actions.approve')}</button>}
          {act.decide && <button type="button" className="cc-btn-ghost" disabled={a.busy || !note.trim()} onClick={() => decide('reject')}><X size={14} aria-hidden="true" /> {t('inventory.pi.actions.reject')}</button>}
          {act.cancel && <button type="button" className="cc-btn-ghost" disabled={a.busy} onClick={() => decide('cancel')}>{t('inventory.pi.corr.cancel')}</button>}
        </div>
      )}
      {a.msg && <Note tone={a.msg.tone}>{a.msg.text}</Note>}
    </div>
  )
}

function TransferRequestsPanel({ scope, userId, t }) {
  const [status, setStatus] = useState('requested')
  const [page, setPage] = useState(0)
  const [stamp, setStamp] = useState(0)
  const size = 20
  const q = useInvQuery(() => listTransferRequests({ status, page, pageSize: size, country: scope.country }), [status, page, scope.country, stamp])
  const rows = q.data?.rows || []
  const total = q.data?.total || 0
  if (q.data?.status === 'not_provisioned') return null
  return (
    <SectionCard title={t('inventory.pi.transfers.title')} sub={t('inventory.pi.transfers.sub')}>
      <select className="cc-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }} aria-label={t('inventory.pi.common.status')}>
        {['requested', 'approved', 'rejected', 'cancelled', 'dispatched', 'all'].map((s) => <option key={s} value={s}>{t(`inventory.pi.transfers.status.${s}`)}</option>)}
      </select>
      {q.error && <ErrorNote error={q.error} onRetry={q.retry} />}
      {!q.error && rows.length === 0 && !q.loading && <p className="cc-na">{t('inventory.pi.transfers.empty')}</p>}
      <div className="inv-pi-results">
        {rows.map((r) => <TransferRequestRow key={r.id} row={r} userId={userId} t={t} onDone={() => setStamp((x) => x + 1)} />)}
      </div>
      {total > size && (
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('inventory.pi.transfers.prev')}</button>
          <span className="cc-na">{page * size + 1}-{Math.min(total, (page + 1) * size)} / {total}</span>
          <button type="button" className="cc-btn-ghost" disabled={(page + 1) * size >= total} onClick={() => setPage((p) => p + 1)}>{t('inventory.pi.transfers.next')}</button>
        </div>
      )}
      <Note>{t('inventory.pi.transfers.rule')}</Note>
    </SectionCard>
  )
}

export default function PhysicalInventoryReview({ view, scope, userId }) {
  const { t } = useLanguage()
  const body = useMemo(() => view, [view])
  if (body === 'review') return <ReviewView scope={scope} t={t} />
  if (body === 'materials') return <MaterialsView scope={scope} t={t} />
  if (body === 'corrections') return <CorrectionsView userId={userId} t={t} />
  if (body === 'search') return <><SearchView scope={scope} t={t} /><TransferRequestsPanel scope={scope} userId={userId} t={t} /></>
  return <Note><ImageIcon size={14} aria-hidden="true" /> {t('inventory.pi.lead')}</Note>
}
