/**
 * Workshop handover: which parts were handed over for a job card, by whom,
 * to whom and when.
 *
 * No table records a parts handover yet, so this screen reads the issue and
 * return movements posted against the job card (source document = the job
 * card) and the receiver written into the issue note when the pick was
 * confirmed (Picking). "Given by" is the user who posted the issue. A
 * signed, separate handover record (receiver acknowledgement) is proposed in
 * docs/warehouse/09_FLOOR_WORKFLOW_DB_CHANGES.md and is not built.
 */
import { useState } from 'react'
import { FileDown, FileSpreadsheet, HeartHandshake, Search } from 'lucide-react'
import { loadHandover } from '../../lib/api/floorWorkflow'
import { normaliseJobCard, HANDOVER_EXPORT_COLUMNS } from '../../lib/inventory/floorWorkflow'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import { KitTable } from '../commandCenter/kit'
import { Field, ErrorNote, Note, NotSetUp, SectionCard, StatusPill, alignNumeric, fmtDateTime } from './InvUi'
import { useLanguage } from '../../contexts/LanguageContext'

const KIND_KEY = { Issued: 'kindIssued', 'Returned to store': 'kindReturned' }

export default function HandoverPanel({ can }) {
  const { t } = useLanguage()
  const p = (k, v) => t(`wmsfloor.handover.${k}`, v)
  const na = <span className="cc-na">{t('wmsfloor.common.na')}</span>
  const kindLabel = (k) => (KIND_KEY[k] ? p(KIND_KEY[k]) : k)
  const canExport = typeof can === 'function' && can('export')
  const [jobCard, setJobCard] = useState('')
  const [state, setState] = useState({ loading: false, error: '', data: null })

  const load = async () => {
    const j = normaliseJobCard(jobCard)
    if (!j) { setState({ loading: false, error: p('enterJobCard'), data: null }); return }
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      setState({ loading: false, error: '', data: await loadHandover(j, { t }) })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), data: null })
    }
  }

  const data = state.data
  const rows = data?.rows || []

  const exportData = () => rows.map((r) => ({ ...r, postedAt: fmtDateTime(r.postedAt), receivedBy: r.kind === 'Issued' ? (r.receivedBy || 'Not recorded') : '' }))
  const exportExcel = () => exportToExcel(
    exportData(), HANDOVER_EXPORT_COLUMNS.map((c) => c.key), HANDOVER_EXPORT_COLUMNS.map((c) => c.header),
    reportFileName('Parts handover', data.jobCard),
  )
  const exportPdf = () => exportToPdf(
    exportData(), HANDOVER_EXPORT_COLUMNS, p('pdfTitle', { jobCard: data.jobCard }), reportFileName('Parts handover', data.jobCard), 'landscape',
  )

  const columns = [
    { key: 'postedAt', header: p('colWhen'), cell: (r) => fmtDateTime(r.postedAt, t('wmsfloor.common.na')) },
    { key: 'kind', header: p('colMovement'), cell: (r) => <StatusPill value={r.kind} tone={r.kind === 'Issued' ? 'info' : 'muted'} label={kindLabel(r.kind)} /> },
    { key: 'itemCode', header: p('colItem'), cell: (r) => r.itemCode || na },
    { key: 'location', header: p('colFrom'), cell: (r) => r.location || na },
    { key: 'qty', header: p('colQty'), numeric: true, cell: (r) => formatQty(r.qty) },
    { key: 'givenBy', header: p('colGivenBy') },
    { key: 'receivedBy', header: p('colReceivedBy'), cell: (r) => (r.kind !== 'Issued' ? <span className="cc-na">-</span>
      : r.receivedBy || <StatusPill value="missing" tone="warn" label={p('notRecorded')} />) },
    { key: 'note', header: p('colNote'), cell: (r) => r.note || na },
  ]
  const itemColumns = [
    { key: 'itemCode', header: p('colItem') },
    { key: 'issued', header: p('colIssued'), numeric: true, cell: (r) => formatQty(r.issued) },
    { key: 'returned', header: p('colReturned'), numeric: true, cell: (r) => formatQty(r.returned) },
    { key: 'net', header: p('colNet'), numeric: true, cell: (r) => formatQty(r.net) },
  ]

  return (
    <>
      <SectionCard title={p('title')} sub={p('sub')}>
        <form className="inv-form" onSubmit={(e) => { e.preventDefault(); load() }}>
          <Field label={p('jobCardLabel')}>
            <input className="inv-input" maxLength={80} value={jobCard} onChange={(e) => setJobCard(e.target.value)} placeholder={p('jobCardPlaceholder')} dir="ltr" />
          </Field>
          <div className="inv-actions">
            <button type="submit" className="cc-btn-primary" disabled={state.loading}>
              <Search size={14} aria-hidden="true" /> {state.loading ? p('loading') : p('show')}
            </button>
          </div>
        </form>
        {state.error && <ErrorNote error={state.error} onRetry={jobCard ? load : undefined} />}
      </SectionCard>

      {data?.status === 'not_provisioned' && <NotSetUp what={p('title')} />}

      {data?.status === 'ok' && (
        <SectionCard
          title={p('jobCardTitle', { jobCard: data.jobCard })}
          sub={data.issuedCount === 1 ? p('issuesOne') : p('issuesMany', { count: data.issuedCount })}
          action={canExport && rows.length ? (
            <div className="inv-actions">
              <button type="button" className="cc-btn-ghost" onClick={exportPdf}><FileDown size={14} aria-hidden="true" /> PDF</button>
              <button type="button" className="cc-btn-ghost" onClick={exportExcel}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
            </div>
          ) : null}>
          {!rows.length && (
            <Note icon={HeartHandshake}>{p('noneIssued')}</Note>
          )}
          {data.missingReceiver > 0 && (
            <Note tone="warn">{p('missingReceiver', { count: data.missingReceiver })}</Note>
          )}
          {data.truncated && <Note tone="warn">{p('truncated', { count: rows.length })}</Note>}
          {rows.length > 0 && (
            <>
              <div className="inv-scroll"><KitTable compact columns={alignNumeric(columns)} rows={rows} empty={p('noMovements')} /></div>
              <p className="cc-card-sub"><strong>{p('perItem')}</strong></p>
              <div className="inv-scroll"><KitTable compact columns={alignNumeric(itemColumns)} rows={data.items} empty={p('noItems')} /></div>
              <Note>{p('receiverNote')}</Note>
            </>
          )}
        </SectionCard>
      )}
    </>
  )
}
