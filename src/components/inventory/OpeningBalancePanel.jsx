/**
 * Opening balance batches (owner correction 2): the existing stock rows are
 * NOT assumed correct. A balance is loaded as a batch with its source file,
 * a column mapping, per-line issues and missing-cost flags, then approved by
 * someone OTHER than the person who created or submitted it. Nothing here
 * invents a historical movement or prices an unpriced line at 0.
 */
import { useMemo, useState } from 'react'
import { Upload, Send, CheckCircle2, XCircle, FilePlus2, ListChecks, AlertTriangle, CircleDollarSign } from 'lucide-react'
import Modal from '../ui/Modal'
import SideDrawer from '../ui/SideDrawer'
import { KitTable, Kpi } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import {
  listOpeningBatches, listOpeningLines, createOpeningBatch, submitOpeningBatch, decideOpeningBatch, newIdempotencyKey,
} from '../../lib/api/inventory'
import { OB_FIELDS, mapHeaders, missingRequired, mapRows, summarizeBatch, canApproveBatch } from '../../lib/inventory/openingBalance'
import { formatMoney, formatQty, formatTotals } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/safeError'
import { useInvQuery, PagedTable, Field, ErrorNote, Note, StatusPill, fmtDateTime } from './InvUi'

const TONE = { draft: 'muted', mapped: 'info', submitted: 'warning', approved: 'good', rejected: 'bad', posted: 'good' }
const PREVIEW_LIMIT = 200

export default function OpeningBalancePanel({ scope, can, userId }) {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const q = useInvQuery(() => listOpeningBatches({ ...scope, page, pageSize }), [scope.country, page, pageSize])
  const [wizard, setWizard] = useState(null)
  const [open, setOpen] = useState(null)
  const [linePage, setLinePage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const lines = useInvQuery(() => (open ? listOpeningLines(open.id, { page: linePage, pageSize: 50 }) : Promise.resolve({ status: 'ok', rows: [], total: 0 })), [open?.id, linePage])

  const readFile = async (file) => {
    setErr('')
    try {
      const { parseWorkbook } = await import('../../lib/import/parseWorkbook')
      const { sheets } = await parseWorkbook(file)
      const sheet = sheets.find((s) => s.rows.length) || sheets[0]
      if (!sheet || !sheet.rows.length) { setErr(t('inventory.opening.emptyFile')); return }
      const headers = sheet.columns.map((c) => c.header)
      setWizard({ filename: file.name, headers, raw: sheet.rows, mapping: mapHeaders(headers), key: newIdempotencyKey() })
    } catch (e) { setErr(toUserMessage(e, t('inventory.opening.readFailed'))) }
  }

  const mapped = useMemo(() => (wizard ? mapRows(wizard.raw, wizard.mapping, { defaultSite: scope.site !== 'all' ? scope.site : null }) : []), [wizard, scope.site])
  const summary = useMemo(() => summarizeBatch(mapped), [mapped])
  const missing = wizard ? missingRequired(wizard.mapping) : []

  const create = async () => {
    setBusy(true); setErr('')
    try {
      await createOpeningBatch({ source: 'file_upload', filename: wizard.filename, site: scope.site !== 'all' ? scope.site : null, country: scope.country, lines: mapped }, wizard.key)
      setWizard(null); q.retry()
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  const act = async (fn) => {
    setBusy(true); setErr('')
    try { await fn(newIdempotencyKey()); setOpen(null); q.retry() } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  const columns = [
    { key: 'ref', header: t('inventory.opening.ref'), cell: (b) => <span className="inv-mono">{b.ref || b.id?.slice(0, 8)}</span> },
    { key: 'source_filename', header: t('inventory.opening.source'), cell: (b) => b.source_filename || b.source || <span className="cc-na">N/A</span> },
    { key: 'site', header: t('inventory.scope.site'), cell: (b) => b.site || <span className="cc-na">N/A</span> },
    { key: 'line_count', header: t('inventory.opening.lines'), numeric: true, cell: (b) => formatQty(b.line_count) },
    { key: 'missing_cost_count', header: t('inventory.opening.missingCost'), numeric: true, cell: (b) => formatQty(b.missing_cost_count) },
    { key: 'status', header: t('inventory.common.status'), cell: (b) => <StatusPill value={b.status} tone={TONE[b.status]} label={t(`inventory.opening.status.${b.status}`)} /> },
    { key: 'created_at', header: t('inventory.common.created'), cell: (b) => fmtDateTime(b.created_at) },
  ]
  const previewCols = [
    { key: 'line_no', header: '#', numeric: true },
    { key: 'item_code', header: t('inventory.common.item'), cell: (l) => l.item_code || <span className="cc-na">N/A</span> },
    { key: 'location_code', header: t('inventory.common.location'), cell: (l) => l.location_code || <span className="cc-na">N/A</span> },
    { key: 'qty', header: t('inventory.count.qty'), numeric: true, cell: (l) => formatQty(l.qty) },
    { key: 'unit_cost', header: t('inventory.opening.unitCost'), numeric: true, cell: (l) => (l.missing_cost ? <StatusPill value="missing" tone="warning" label={t('inventory.opening.costMissing')} /> : formatMoney(l.unit_cost, l.currency)) },
    { key: 'issues', header: t('inventory.opening.issues'), sortable: false, cell: (l) => (l.issues?.length ? l.issues.map((i) => t(`inventory.opening.issue.${i}`)).join(', ') : <StatusPill value="ok" tone="good" label={t('inventory.opening.ready')} />) },
  ]
  const approval = open ? canApproveBatch(open, userId, can) : null

  return (
    <div className="inv-hub">
      <Note>{t('inventory.opening.rule')}</Note>
      <div className="inv-actions">
        {can('audit_create') && (
          <label className="cc-btn-primary" style={{ cursor: 'pointer' }}>
            <Upload size={14} aria-hidden="true" /> {t('inventory.opening.upload')}
            <input type="file" accept=".xlsx,.xls,.csv" style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readFile(f) }} />
          </label>
        )}
      </div>
      {err && !wizard && !open && <ErrorNote error={err} />}
      <PagedTable query={q} columns={columns} page={page} pageSize={pageSize} onPage={setPage}
        onPageSize={(s) => { setPageSize(s); setPage(0) }} empty={t('inventory.opening.empty')}
        what={t('inventory.objects.opening_balance_batches')} noun={t('inventory.opening.noun')}
        onRowClick={(b) => { setOpen(b); setLinePage(0); setErr(''); setNote('') }} />

      <Modal className="cc inv-panel" open={!!wizard} onClose={() => !busy && setWizard(null)} size="xl" title={t('inventory.opening.wizardTitle')}
        subtitle={wizard?.filename}
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => setWizard(null)} disabled={busy}>{t('inventory.actions.cancel')}</button>
            <button type="button" className="cc-btn-primary" onClick={create} disabled={busy || missing.length > 0 || !mapped.length}>
              <FilePlus2 size={14} aria-hidden="true" /> {busy ? t('inventory.actions.saving') : t('inventory.opening.createDraft')}
            </button>
          </div>
        )}>
        {wizard && (
          <div className="inv-hub" style={{ gap: 12 }}>
            <h4 className="cc-card-title">{t('inventory.opening.mapping')}</h4>
            <div className="inv-form">
              {OB_FIELDS.map((f) => (
                <Field key={f.key} label={`${t(`inventory.opening.field.${f.key}`)}${f.required ? ' *' : ''}`}>
                  <select className="cc-select" value={wizard.mapping[f.key] || ''}
                    onChange={(e) => setWizard((w) => ({ ...w, mapping: { ...w.mapping, [f.key]: e.target.value || undefined } }))}>
                    <option value="">{t('inventory.opening.notMapped')}</option>
                    {wizard.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            {missing.length > 0 && <Note tone="bad">{t('inventory.opening.missingRequired', { fields: missing.map((m) => t(`inventory.opening.field.${m}`)).join(', ') })}</Note>}
            <div className="inv-kpis">
              <Kpi icon={ListChecks} tone="t-blue" value={summary.lines} label={t('inventory.opening.lines')} />
              <Kpi icon={AlertTriangle} tone="t-red" value={summary.blocking} label={t('inventory.opening.blocking')} />
              <Kpi icon={CircleDollarSign} tone="t-amber" value={summary.missingCost} label={t('inventory.opening.missingCost')} />
              <Kpi icon={CircleDollarSign} tone="t-green" display={formatTotals(summary.value.totals)} label={t('inventory.opening.pricedValue')} />
            </div>
            <p className="cc-card-sub">{t('inventory.opening.pricedPct', { pct: summary.pricedPct ?? 'N/A' })}</p>
            {mapped.length > PREVIEW_LIMIT && <p className="cc-card-sub">{t('inventory.opening.previewNote', { shown: PREVIEW_LIMIT, total: mapped.length })}</p>}
            <KitTable compact scroll columns={previewCols} rows={mapped.slice(0, PREVIEW_LIMIT)} empty={t('inventory.opening.noLines')} />
            {err && <ErrorNote error={err} />}
          </div>
        )}
      </Modal>

      <SideDrawer className="cc inv-panel" open={!!open} onClose={() => setOpen(null)} busy={busy} size="xl"
        title={open ? `${t('inventory.opening.batch')} ${open.ref || open.id?.slice(0, 8)}` : ''} closeLabel={t('inventory.actions.close')}>
        {open && (
          <div className="inv-hub" style={{ gap: 12 }}>
            <dl className="inv-dl">
              <dt>{t('inventory.common.status')}</dt><dd><StatusPill value={open.status} tone={TONE[open.status]} label={t(`inventory.opening.status.${open.status}`)} /></dd>
              <dt>{t('inventory.opening.source')}</dt><dd>{open.source_filename || open.source || 'N/A'}</dd>
              <dt>{t('inventory.opening.missingCost')}</dt><dd>{formatQty(open.missing_cost_count)}</dd>
              <dt>{t('inventory.common.created')}</dt><dd>{fmtDateTime(open.created_at)}</dd>
            </dl>
            <PagedTable query={lines} columns={previewCols.map((c) => (c.key === 'issues' ? { ...c, cell: (l) => (Array.isArray(l.issues) && l.issues.length ? l.issues.join(', ') : l.mapping_status || 'N/A') } : c))}
              page={linePage} pageSize={50} onPage={setLinePage} empty={t('inventory.opening.noLines')}
              what={t('inventory.objects.opening_balance_batches')} noun={t('inventory.opening.linesNoun')} />
            {['draft', 'mapped'].includes(open.status) && open.created_by === userId && (
              <button type="button" className="cc-btn-primary" disabled={busy} onClick={() => act((k) => submitOpeningBatch(open.id, k))}>
                <Send size={14} aria-hidden="true" /> {t('inventory.opening.submit')}
              </button>
            )}
            {open.status === 'submitted' && (approval?.ok ? (
              <>
                <Field label={t('inventory.disc.decisionNote')} full>
                  <textarea className="inv-input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <div className="inv-actions">
                  <button type="button" className="cc-btn-primary" disabled={busy} onClick={() => act((k) => decideOpeningBatch({ batchId: open.id, decision: 'approve', note }, k))}><CheckCircle2 size={14} aria-hidden="true" /> {t('inventory.disc.approve')}</button>
                  <button type="button" className="cc-btn-ghost" disabled={busy || !note.trim()} onClick={() => act((k) => decideOpeningBatch({ batchId: open.id, decision: 'reject', note }, k))}><XCircle size={14} aria-hidden="true" /> {t('inventory.disc.reject')}</button>
                </div>
              </>
            ) : <Note tone="warn">{t(approval?.reason || 'inventory.approve.noCapability')}</Note>)}
            {err && <ErrorNote error={err} />}
          </div>
        )}
      </SideDrawer>
    </div>
  )
}
