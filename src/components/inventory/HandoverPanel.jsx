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

export default function HandoverPanel({ can }) {
  const canExport = typeof can === 'function' && can('export')
  const [jobCard, setJobCard] = useState('')
  const [state, setState] = useState({ loading: false, error: '', data: null })

  const load = async () => {
    const j = normaliseJobCard(jobCard)
    if (!j) { setState({ loading: false, error: 'Enter a job card number.', data: null }); return }
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      setState({ loading: false, error: '', data: await loadHandover(j) })
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
    exportData(), HANDOVER_EXPORT_COLUMNS, `Parts handover: job card ${data.jobCard}`, reportFileName('Parts handover', data.jobCard), 'landscape',
  )

  const columns = [
    { key: 'postedAt', header: 'When', cell: (r) => fmtDateTime(r.postedAt) },
    { key: 'kind', header: 'Movement', cell: (r) => <StatusPill value={r.kind} tone={r.kind === 'Issued' ? 'info' : 'muted'} label={r.kind} /> },
    { key: 'itemCode', header: 'Item', cell: (r) => r.itemCode || <span className="cc-na">N/A</span> },
    { key: 'location', header: 'From location', cell: (r) => r.location || <span className="cc-na">N/A</span> },
    { key: 'qty', header: 'Qty', numeric: true, cell: (r) => formatQty(r.qty) },
    { key: 'givenBy', header: 'Given by' },
    { key: 'receivedBy', header: 'Received by', cell: (r) => (r.kind !== 'Issued' ? <span className="cc-na">-</span>
      : r.receivedBy || <StatusPill value="missing" tone="warn" label="Not recorded" />) },
    { key: 'note', header: 'Note', cell: (r) => r.note || <span className="cc-na">N/A</span> },
  ]
  const itemColumns = [
    { key: 'itemCode', header: 'Item' },
    { key: 'issued', header: 'Issued', numeric: true, cell: (r) => formatQty(r.issued) },
    { key: 'returned', header: 'Returned', numeric: true, cell: (r) => formatQty(r.returned) },
    { key: 'net', header: 'With the workshop', numeric: true, cell: (r) => formatQty(r.net) },
  ]

  return (
    <>
      <SectionCard title="Workshop handover" sub="Parts issued to a job card: who gave them, who received them and when.">
        <form className="inv-form" onSubmit={(e) => { e.preventDefault(); load() }}>
          <Field label="Job card number">
            <input className="inv-input" maxLength={80} value={jobCard} onChange={(e) => setJobCard(e.target.value)} placeholder="e.g. GCKR/JC/0082/0323" />
          </Field>
          <div className="inv-actions">
            <button type="submit" className="cc-btn-primary" disabled={state.loading}>
              <Search size={14} aria-hidden="true" /> {state.loading ? 'Loading...' : 'Show handover'}
            </button>
          </div>
        </form>
        {state.error && <ErrorNote error={state.error} onRetry={jobCard ? load : undefined} />}
      </SectionCard>

      {data?.status === 'not_provisioned' && <NotSetUp what="Workshop handover" />}

      {data?.status === 'ok' && (
        <SectionCard
          title={`Job card ${data.jobCard}`}
          sub={`${data.issuedCount} issue${data.issuedCount === 1 ? '' : 's'} recorded`}
          action={canExport && rows.length ? (
            <div className="inv-actions">
              <button type="button" className="cc-btn-ghost" onClick={exportPdf}><FileDown size={14} aria-hidden="true" /> PDF</button>
              <button type="button" className="cc-btn-ghost" onClick={exportExcel}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
            </div>
          ) : null}>
          {!rows.length && (
            <Note icon={HeartHandshake}>No parts have been issued against this job card. Picks confirmed in Picking appear here.</Note>
          )}
          {data.missingReceiver > 0 && (
            <Note tone="warn">{data.missingReceiver} issue{data.missingReceiver === 1 ? '' : 's'} do not name who received the parts. Name the receiver when confirming the pick.</Note>
          )}
          {data.truncated && <Note tone="warn">This job card has more movements than one list can show. The first {rows.length} are listed.</Note>}
          {rows.length > 0 && (
            <>
              <div className="inv-scroll"><KitTable compact columns={alignNumeric(columns)} rows={rows} empty="No movements" /></div>
              <p className="cc-card-sub"><strong>Per item</strong></p>
              <div className="inv-scroll"><KitTable compact columns={alignNumeric(itemColumns)} rows={data.items} empty="No items" /></div>
              <Note>The receiver is taken from the issue note. A signed handover record (receiver acknowledgement) is not built yet.</Note>
            </>
          )}
        </SectionCard>
      )}
    </>
  )
}
