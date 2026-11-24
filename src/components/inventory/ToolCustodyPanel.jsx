/**
 * Tool custody: who holds which tool or returnable item, what is due back and
 * what is overdue.
 *
 * Built on what exists: the Tool & Equipment Registry (`equipment`, /equipment)
 * says what a tool is and whether it is in use; material issues to a named
 * person say who took returnable stock. Holder and due-back date per tool need
 * the custody table proposed in docs/warehouse/10_ASSETS_FINANCE_DB_CHANGES.md;
 * until it exists the screen says so and never guesses a holder.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Wrench, UserCheck, AlarmClock, HelpCircle, PackageOpen } from 'lucide-react'
import { Kpi, KitTable } from '../commandCenter/kit'
import { useInvQuery, ErrorNote, Note, SectionCard, StatusPill, fmtDate, alignNumeric } from './InvUi'
import { listTools, listToolCustody, listIssuesToPeople } from '../../lib/api/warehouseAssets'
import { summarizeTools, openCustody, heldByPerson, CUSTODY_STATUS } from '../../lib/inventory/warehouseAssets'
import { formatQty } from '../../lib/inventory/inventoryMoney'

const STATUS_TONE = { overdue: 'bad', out: 'info', no_due_date: 'warn', returned: 'good' }

export default function ToolCustodyPanel({ scope }) {
  const tools = useInvQuery(() => listTools({ country: scope.country }), [scope.country])
  const custody = useInvQuery(() => listToolCustody(scope), [scope.country, scope.site])
  const issues = useInvQuery(() => listIssuesToPeople(scope), [scope.country, scope.site])

  const custodyRows = custody.data?.status === 'ok' ? custody.data.rows : null
  const toolRows = useMemo(() => {
    const rows = tools.data?.rows || []
    return scope.site && scope.site !== 'all' ? rows.filter((r) => String(r.site || '').toUpperCase() === String(scope.site).toUpperCase()) : rows
  }, [tools.data, scope.site])
  const toolById = useMemo(() => new Map(toolRows.map((t) => [t.id, t])), [toolRows])
  const sum = summarizeTools(toolRows, custodyRows)
  const open = useMemo(() => (custodyRows ? openCustody(custodyRows) : []), [custodyRows])
  const held = useMemo(() => heldByPerson(issues.data?.rows), [issues.data])
  const inUse = toolRows.filter((t) => t.status === 'in_use')

  const loading = tools.loading && !tools.data
  const notTracked = custody.data?.status === 'not_provisioned'

  return (
    <div className="inv-hub" style={{ gap: 14 }}>
      {tools.error && <ErrorNote error={tools.error} onRetry={tools.retry} />}
      {custody.error && <ErrorNote error={custody.error} onRetry={custody.retry} />}

      <div className="inv-kpis">
        <Kpi icon={Wrench} tone="t-blue" loading={loading} value={tools.data ? sum.tools : null} label="Tools in the registry" />
        <Kpi icon={PackageOpen} tone="t-orange" loading={loading} value={tools.data ? (sum.byStatus.in_use || 0) : null} label="Marked in use" />
        <Kpi icon={UserCheck} tone="t-green" loading={custody.loading && !custody.data}
          display={notTracked ? 'Not tracked' : undefined} value={notTracked ? null : sum.open} label="Out with a named holder" />
        <Kpi icon={AlarmClock} tone="t-red" loading={custody.loading && !custody.data} danger={sum.overdue > 0}
          display={notTracked ? 'Not tracked' : undefined} value={notTracked ? null : sum.overdue} label="Overdue for return" />
        <Kpi icon={HelpCircle} tone="t-amber" loading={loading} value={tools.data ? sum.inUseUnknownHolder : null} label="In use, holder not recorded" />
      </div>

      {notTracked && (
        <Note tone="warn" title="Holder and due date are not recorded yet">
          The Tool &amp; Equipment Registry records what each tool is and whether it is in use, but not who has it or when it is
          due back. The custody log that adds this is proposed (docs/warehouse/10_ASSETS_FINANCE_DB_CHANGES.md). Until it is
          installed, a tool marked in use shows its holder as Not recorded, and no tool is called overdue.
        </Note>
      )}
      {tools.data && sum.tools === 0 && (
        <Note tone="info" title="No tools registered">
          Register tools and returnable equipment in the <Link to="/equipment">Tool &amp; Equipment Registry</Link> (administrators).
        </Note>
      )}

      {!notTracked && (
        <SectionCard title="Out with a holder" sub="Overdue first, then longest out. A row without a due date is never called overdue.">
          <div className="inv-scroll">
            <KitTable compact loading={custody.loading && !custody.data} rows={open} empty="Nothing is out with a holder."
              columns={alignNumeric([
                { key: 'tool', header: 'Tool', cell: (r) => toolById.get(r.equipment_id)?.name || 'Unknown tool' },
                { key: 'serial', header: 'Serial', cell: (r) => toolById.get(r.equipment_id)?.serial_no || 'N/A' },
                { key: 'holder_name', header: 'Holder', cell: (r) => r.holder_name || 'Not recorded' },
                { key: 'issued_at', header: 'Issued', cell: (r) => fmtDate(r.issued_at) },
                { key: 'due_back_at', header: 'Due back', cell: (r) => fmtDate(r.due_back_at) },
                { key: 'daysOut', header: 'Days out', numeric: true, cell: (r) => r.daysOut ?? 'N/A' },
                { key: 'status', header: 'Status', cell: (r) => <StatusPill value={r.status} tone={STATUS_TONE[r.status]} label={CUSTODY_STATUS[r.status]} /> },
                { key: 'daysOverdue', header: 'Days overdue', numeric: true, cell: (r) => r.daysOverdue ?? '' },
              ])} />
          </div>
        </SectionCard>
      )}

      <SectionCard title="Tools marked in use" sub="From the Tool & Equipment Registry.">
        <div className="inv-scroll">
          <KitTable compact loading={loading} rows={inUse} empty="No tool is marked in use."
            columns={[
              { key: 'name', header: 'Tool' },
              { key: 'equipment_type', header: 'Type' },
              { key: 'serial_no', header: 'Serial' },
              { key: 'site', header: 'Site' },
              { key: 'holder', header: 'Holder', cell: (r) => {
                const o = open.find((c) => c.equipment_id === r.id)
                return o?.holder_name || <span className="cc-na">Not recorded</span>
              } },
              { key: 'calibration_due', header: 'Calibration due', cell: (r) => fmtDate(r.calibration_due) },
            ]} />
        </div>
      </SectionCard>

      <SectionCard title="Stock held by a person" sub="Material issues to a named person, less returns. The issue ledger has no due date, so nothing here is called overdue.">
        {issues.error ? <ErrorNote error={issues.error} onRetry={issues.retry} /> : (
          <>
            {issues.data?.truncated && <Note tone="warn">Only the newest issues were read. Narrow the site to see all of them.</Note>}
            <div className="inv-scroll">
              <KitTable compact loading={issues.loading && !issues.data} rows={held} empty="No stock is recorded as issued to a named person."
                columns={alignNumeric([
                  { key: 'holder', header: 'Held by' },
                  { key: 'item_code', header: 'Item code' },
                  { key: 'description', header: 'Description', cell: (r) => r.description || 'N/A' },
                  { key: 'qty', header: 'Quantity held', numeric: true, cell: (r) => formatQty(r.qty) },
                  { key: 'lastIssued', header: 'Last issued', cell: (r) => fmtDate(r.lastIssued) },
                ])} />
            </div>
          </>
        )}
      </SectionCard>
    </div>
  )
}
