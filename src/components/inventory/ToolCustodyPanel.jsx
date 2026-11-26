/**
 * Tool custody: who holds which tool or returnable item, what is due back and
 * what is overdue.
 *
 * Built on what exists: the Tool & Equipment Registry (`equipment`, /equipment)
 * says what a tool is and whether it is in use; material issues to a named
 * person say who took returnable stock. Holder and due-back date per tool need
 * the custody log (migration 20261124133000, NOT APPLIED); until it exists the
 * screen says so and never guesses a holder. Issue, return and calibration are
 * server RPCs (equipment_issue / equipment_return / equipment_record_calibration).
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wrench, UserCheck, AlarmClock, HelpCircle, PackageOpen, Gauge } from 'lucide-react'
import { Kpi, KitTable } from '../commandCenter/kit'
import { useInvQuery, ErrorNote, Note, SectionCard, StatusPill, fmtDate, alignNumeric } from './InvUi'
import { listTools, listToolCustody, listIssuesToPeople } from '../../lib/api/warehouseAssets'
import { summarizeTools, openCustody, heldByPerson, CUSTODY_STATUS } from '../../lib/inventory/warehouseAssets'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { calibrationWatchList, calibrationState } from '../../lib/warehouseClasses/specialClasses'
import { IssueToolModal, ReturnToolModal, CalibrationModal } from '../warehouseClasses/ToolModals'
import { useLanguage } from '../../contexts/LanguageContext'

const STATUS_TONE = { overdue: 'bad', out: 'info', no_due_date: 'warn', returned: 'good' }

const CAL_TONE = { overdue: 'bad', due_soon: 'warn', ok: 'good', not_set: 'muted' }
const CAL_STATES = ['overdue', 'due_soon', 'ok', 'not_set']

export default function ToolCustodyPanel({ scope, can = () => false }) {
  const { t } = useLanguage()
  const p = (k, v) => t(`wmsfloor.tools.${k}`, v)
  const NA = t('wmsfloor.common.na')
  const calLabel = (k) => (CAL_STATES.includes(k) ? t(`wmsfloor.tools.cal.${k}`) : k)
  const custodyLabel = (k) => (CUSTODY_STATUS[k] ? t(`wmsfloor.tools.custody.${k}`) : k)
  const [issueFor, setIssueFor] = useState(null)
  const [returnFor, setReturnFor] = useState(null)
  const [calFor, setCalFor] = useState(null)
  const tools = useInvQuery(() => listTools({ country: scope.country }), [scope.country])
  const custody = useInvQuery(() => listToolCustody(scope), [scope.country, scope.site])
  const issues = useInvQuery(() => listIssuesToPeople(scope), [scope.country, scope.site])

  const custodyRows = custody.data?.status === 'ok' ? custody.data.rows : null
  const toolRows = useMemo(() => {
    const rows = tools.data?.rows || []
    return scope.site && scope.site !== 'all' ? rows.filter((r) => String(r.site || '').toUpperCase() === String(scope.site).toUpperCase()) : rows
  }, [tools.data, scope.site])
  const toolById = useMemo(() => new Map(toolRows.map((x) => [x.id, x])), [toolRows])
  const sum = summarizeTools(toolRows, custodyRows)
  const open = useMemo(() => (custodyRows ? openCustody(custodyRows) : []), [custodyRows])
  const held = useMemo(() => heldByPerson(issues.data?.rows), [issues.data])
  const inUse = toolRows.filter((x) => x.status === 'in_use')

  const loading = tools.loading && !tools.data
  const notTracked = custody.data?.status === 'not_provisioned'
  const calWatch = useMemo(() => calibrationWatchList(toolRows), [toolRows])
  const openToolIds = useMemo(() => new Set(open.map((c) => c.equipment_id)), [open])
  const issuable = toolRows.filter((x) => x.status === 'available' && !openToolIds.has(x.id))
  const canIssue = can('issue') && !notTracked
  const canCalibrate = can('engineering_approve') && !notTracked
  const refresh = () => { tools.retry(); custody.retry() }

  return (
    <div className="inv-hub" style={{ gap: 14 }}>
      {tools.error && <ErrorNote error={tools.error} onRetry={tools.retry} />}
      {custody.error && <ErrorNote error={custody.error} onRetry={custody.retry} />}

      <div className="inv-kpis">
        <Kpi icon={Wrench} tone="t-blue" loading={loading} value={tools.data ? sum.tools : null} label={p('kpiTools')} />
        <Kpi icon={PackageOpen} tone="t-orange" loading={loading} value={tools.data ? (sum.byStatus.in_use || 0) : null} label={p('kpiInUse')} />
        <Kpi icon={UserCheck} tone="t-green" loading={custody.loading && !custody.data}
          display={notTracked ? p('notTracked') : undefined} value={notTracked ? null : sum.open} label={p('kpiOpen')} />
        <Kpi icon={AlarmClock} tone="t-red" loading={custody.loading && !custody.data} danger={sum.overdue > 0}
          display={notTracked ? p('notTracked') : undefined} value={notTracked ? null : sum.overdue} label={p('kpiOverdue')} />
        <Kpi icon={HelpCircle} tone="t-amber" loading={loading} value={tools.data ? sum.inUseUnknownHolder : null} label={p('kpiUnknownHolder')} />
        <Kpi icon={Gauge} tone="t-red" loading={loading} danger={calWatch.some((r) => r.state === 'overdue')}
          value={tools.data ? calWatch.filter((r) => r.state === 'overdue').length : null} label={p('kpiCalOverdue')} />
      </div>

      {notTracked && (
        <Note tone="warn" title={p('notTrackedTitle')}>
          {p('notTrackedBody')}
        </Note>
      )}
      {tools.data && sum.tools === 0 && (
        <Note tone="info" title={p('noToolsTitle')}>
          {p('noToolsBefore')} <Link to="/equipment">{p('registry')}</Link> {p('noToolsAfter')}
        </Note>
      )}

      {!notTracked && (
        <SectionCard title={p('outTitle')} sub={p('outSub')}>
          <div className="inv-scroll">
            <KitTable compact loading={custody.loading && !custody.data} rows={open} empty={p('outEmpty')}
              columns={alignNumeric([
                { key: 'tool', header: p('colTool'), cell: (r) => toolById.get(r.equipment_id)?.name || p('unknownTool') },
                { key: 'serial', header: p('colSerial'), cell: (r) => toolById.get(r.equipment_id)?.serial_no || NA },
                { key: 'holder_name', header: p('colHolder'), cell: (r) => r.holder_name || p('notRecorded') },
                { key: 'issued_at', header: p('colIssued'), cell: (r) => fmtDate(r.issued_at, NA) },
                { key: 'due_back_at', header: p('colDueBack'), cell: (r) => fmtDate(r.due_back_at, NA) },
                { key: 'daysOut', header: p('colDaysOut'), numeric: true, cell: (r) => r.daysOut ?? NA },
                { key: 'status', header: p('colStatus'), cell: (r) => <StatusPill value={r.status} tone={STATUS_TONE[r.status]} label={custodyLabel(r.status)} /> },
                { key: 'daysOverdue', header: p('colDaysOverdue'), numeric: true, cell: (r) => r.daysOverdue ?? '' },
                { key: 'act', header: '', sortable: false, cell: (r) => (can('issue')
                  ? <button type="button" className="cc-btn-ghost" onClick={() => setReturnFor(r)}>{p('recordReturn')}</button> : null) },
              ])} />
          </div>
        </SectionCard>
      )}

      {canIssue && (
        <SectionCard title={p('availTitle')} sub={p('availSub')}>
          <div className="inv-scroll">
            <KitTable compact loading={loading} rows={issuable} empty={p('availEmpty')}
              columns={[
                { key: 'name', header: p('colTool') },
                { key: 'serial_no', header: p('colSerial'), cell: (r) => r.serial_no || NA },
                { key: 'site', header: p('colSite'), cell: (r) => r.site || NA },
                { key: 'cal', header: p('colCalibration'), cell: (r) => {
                  const c = calibrationState(r)
                  return <StatusPill value={c.state} tone={CAL_TONE[c.state]} label={c.state === 'not_set' ? calLabel('not_set') : `${calLabel(c.state)}: ${fmtDate(r.calibration_due, NA)}`} />
                } },
                { key: 'act', header: '', sortable: false, cell: (r) => <button type="button" className="cc-btn-ghost" onClick={() => setIssueFor(r)}>{p('issue')}</button> },
              ]} />
          </div>
        </SectionCard>
      )}

      <SectionCard title={p('calTitle')} sub={p('calSub')}>
        <div className="inv-scroll">
          <KitTable compact loading={loading} rows={calWatch} empty={p('calEmpty')}
            columns={alignNumeric([
              { key: 'name', header: p('colTool') },
              { key: 'serial_no', header: p('colSerial'), cell: (r) => r.serial_no || NA },
              { key: 'site', header: p('colSite'), cell: (r) => r.site || NA },
              { key: 'calibration_due', header: p('colDue'), cell: (r) => fmtDate(r.calibration_due, NA) },
              { key: 'state', header: p('colStatus'), cell: (r) => <StatusPill value={r.state} tone={CAL_TONE[r.state]} label={calLabel(r.state)} /> },
              { key: 'days', header: p('colDays'), numeric: true, cell: (r) => (r.state === 'overdue' ? p('daysOver', { n: r.days }) : p('daysLeft', { n: r.days })) },
              { key: 'act', header: '', sortable: false, cell: (r) => (canCalibrate
                ? <button type="button" className="cc-btn-ghost" onClick={() => setCalFor(r)}>{p('recordCal')}</button> : null) },
            ])} />
        </div>
        {canCalibrate && toolRows.length > calWatch.length && (
          <p className="cc-card-sub">{p('calHint')}</p>
        )}
      </SectionCard>

      <SectionCard title={p('inUseTitle')} sub={p('inUseSub')}>
        <div className="inv-scroll">
          <KitTable compact loading={loading} rows={inUse} empty={p('inUseEmpty')}
            columns={[
              { key: 'name', header: p('colTool') },
              { key: 'equipment_type', header: p('colType') },
              { key: 'serial_no', header: p('colSerial') },
              { key: 'site', header: p('colSite') },
              { key: 'holder', header: p('colHolder'), cell: (r) => {
                const o = open.find((c) => c.equipment_id === r.id)
                return o?.holder_name || <span className="cc-na">{p('notRecorded')}</span>
              } },
              { key: 'calibration_due', header: p('colCalDue'), cell: (r) => fmtDate(r.calibration_due, NA) },
            ]} />
        </div>
      </SectionCard>

      {canCalibrate && toolRows.length > 0 && (
        <SectionCard title={p('allTitle')} sub={p('allSub')}>
          <div className="inv-scroll">
            <KitTable compact rows={toolRows}
              columns={[
                { key: 'name', header: p('colTool') },
                { key: 'serial_no', header: p('colSerial'), cell: (r) => r.serial_no || NA },
                { key: 'status', header: p('colStatus') },
                { key: 'calibration_due', header: p('colCalDue'), cell: (r) => (r.calibration_due ? fmtDate(r.calibration_due, NA) : calLabel('not_set')) },
                { key: 'act', header: '', sortable: false, cell: (r) => <button type="button" className="cc-btn-ghost" onClick={() => setCalFor(r)}>{p('recordCal')}</button> },
              ]} />
          </div>
        </SectionCard>
      )}

      <SectionCard title={p('heldTitle')} sub={p('heldSub')}>
        {issues.error ? <ErrorNote error={issues.error} onRetry={issues.retry} /> : (
          <>
            {issues.data?.truncated && <Note tone="warn">{p('heldTruncated')}</Note>}
            <div className="inv-scroll">
              <KitTable compact loading={issues.loading && !issues.data} rows={held} empty={p('heldEmpty')}
                columns={alignNumeric([
                  { key: 'holder', header: p('colHeldBy') },
                  { key: 'item_code', header: p('colItemCode') },
                  { key: 'description', header: p('colDescription'), cell: (r) => r.description || NA },
                  { key: 'qty', header: p('colQtyHeld'), numeric: true, cell: (r) => formatQty(r.qty) },
                  { key: 'lastIssued', header: p('colLastIssued'), cell: (r) => fmtDate(r.lastIssued, NA) },
                ])} />
            </div>
          </>
        )}
      </SectionCard>

      {issueFor && <IssueToolModal tool={issueFor} onClose={() => setIssueFor(null)} onDone={() => { setIssueFor(null); refresh() }} />}
      {returnFor && <ReturnToolModal custody={returnFor} toolName={toolById.get(returnFor.equipment_id)?.name}
        onClose={() => setReturnFor(null)} onDone={() => { setReturnFor(null); refresh() }} />}
      {calFor && <CalibrationModal tool={calFor} onClose={() => setCalFor(null)} onDone={() => { setCalFor(null); refresh() }} />}
    </div>
  )
}
