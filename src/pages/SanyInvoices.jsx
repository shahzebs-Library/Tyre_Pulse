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
        { key: 'doc_type', header: 'Type', render: (r) => (r.doc_type === 'proforma' ? 'Proforma' : r.doc_type === 'detail' ? 'Detail' : 'Summary') },
        { key: 'invoice_date', header: 'Date' },
        { key: 'region', header: 'Region' },
        { key: 'invoice_no', header: 'Quotation No' },
        { key: 'asset_no', header: 'Asset' },
        { key: 'description', header: 'Parts' },
        { key: 'amount', header: 'Amount (Cost/M3)', align: 'right', kind: 'money' },
        { key: 'gross_amount', header: 'Gross USD', align: 'right', render: (r) => (r.gross_amount == null ? '-' : Math.round(r.gross_amount).toLocaleString()) },
        { key: 'net_amount', header: 'Net USD', align: 'right', render: (r) => (r.net_amount == null ? '-' : Math.round(r.net_amount).toLocaleString()) },
        { key: 'currency', header: 'Cur' },
      ]}
      formFields={[
        { key: 'invoice_date', label: 'Date', type: 'text' },
        { key: 'period_date', label: 'Month', type: 'month', required: true },
        { key: 'region', label: 'Region (Western / Central)', type: 'text' },
        { key: 'invoice_no', label: 'Quotation No', type: 'text' },
        { key: 'asset_no', label: 'Asset (detail only)', type: 'text' },
        { key: 'description', label: 'Parts description (detail only)', type: 'text' },
        { key: 'amount', label: 'Amount (SAR)', type: 'number', required: true },
        { key: 'doc_type', label: 'Type', type: 'select', options: ['summary', 'detail'] },
      ]}
    />
  )
}
