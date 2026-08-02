/**
 * ScoCosts (route /sco-costs) - SCO cost ledger for the Cost per M3 module.
 * Manual entry + Excel/CSV import + list, one country + one month at a time.
 */
import { Boxes } from 'lucide-react'
import LedgerPage from '../components/costm3/LedgerPage'
import { listScoCosts, createScoCost, importScoCosts, deleteScoCost } from '../lib/api/costPerM3'

export default function ScoCosts() {
  return (
    <LedgerPage
      title="SCO Cost"
      subtitle="Subcontractor / SCO costs that feed the Cost per M3 grand total"
      icon={Boxes}
      kind="sco"
      service={{ list: listScoCosts, create: createScoCost, import: importScoCosts, remove: deleteScoCost }}
      columns={[
        { key: 'period_date', header: 'Month' },
        { key: 'region', header: 'Region' },
        { key: 'site', header: 'Site' },
        { key: 'cost_center', header: 'Cost Center' },
        { key: 'description', header: 'Description' },
        { key: 'ref_no', header: 'Ref No' },
        { key: 'amount', header: 'Amount', align: 'right', kind: 'money' },
        { key: 'currency', header: 'Cur' },
      ]}
      formFields={[
        { key: 'period_date', label: 'Month', type: 'month', required: true },
        { key: 'region', label: 'Region', type: 'text' },
        { key: 'site', label: 'Site', type: 'text' },
        { key: 'cost_center', label: 'Cost Center', type: 'text' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'ref_no', label: 'Ref No', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        { key: 'currency', label: 'Currency', type: 'text' },
      ]}
    />
  )
}
