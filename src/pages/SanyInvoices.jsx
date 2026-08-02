/**
 * SanyInvoices (route /sany-invoices) - SANY workshop invoice ledger for the
 * Cost per M3 module. Manual entry + Excel/CSV import + list, one country + one
 * month at a time.
 */
import { FileText } from 'lucide-react'
import LedgerPage from '../components/costm3/LedgerPage'
import { listSanyInvoices, createSanyInvoice, importSanyInvoices, deleteSanyInvoice } from '../lib/api/costPerM3'

export default function SanyInvoices() {
  return (
    <LedgerPage
      title="SANY Workshop Invoices"
      subtitle="SANY workshop invoice costs that feed the Cost per M3 grand total"
      icon={FileText}
      kind="sany"
      service={{ list: listSanyInvoices, create: createSanyInvoice, import: importSanyInvoices, remove: deleteSanyInvoice }}
      columns={[
        { key: 'period_date', header: 'Month' },
        { key: 'region', header: 'Region' },
        { key: 'site', header: 'Site' },
        { key: 'asset_no', header: 'Asset' },
        { key: 'invoice_no', header: 'Invoice No' },
        { key: 'invoice_date', header: 'Invoice Date' },
        { key: 'description', header: 'Description' },
        { key: 'status', header: 'Status' },
        { key: 'amount', header: 'Amount', align: 'right', kind: 'money' },
        { key: 'currency', header: 'Cur' },
      ]}
      formFields={[
        { key: 'period_date', label: 'Month', type: 'month', required: true },
        { key: 'region', label: 'Region', type: 'text' },
        { key: 'site', label: 'Site', type: 'text' },
        { key: 'asset_no', label: 'Asset', type: 'text' },
        { key: 'invoice_no', label: 'Invoice No', type: 'text' },
        { key: 'invoice_date', label: 'Invoice Date', type: 'text' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'status', label: 'Status', type: 'select', options: ['received', 'approved', 'paid', 'disputed'] },
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        { key: 'currency', label: 'Currency', type: 'text' },
      ]}
    />
  )
}
