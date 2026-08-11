/**
 * SanyInvoices (route /sany-invoices) - SANY workshop invoice ledger for the
 * Cost per M3 module. Manual entry + Excel/CSV import + list, one country + one
 * month at a time.
 */
import { useState } from 'react'
import { FileText, List } from 'lucide-react'
import LedgerPage from '../components/costm3/LedgerPage'
import LedgerMonthlySummary from '../components/costm3/LedgerMonthlySummary'
import SanyInvoiceLinesModal from '../components/costm3/SanyInvoiceLinesModal'
import { listSanyInvoices, createSanyInvoice, importSanyInvoices, deleteSanyInvoice } from '../lib/api/costPerM3'

export default function SanyInvoices() {
  // A SANY invoice is a table of machines. The ledger row is only its total, so
  // every row opens the document behind it.
  const [openInvoice, setOpenInvoice] = useState(null)

  return (
    <div>
    <div className="p-4 md:p-6 max-w-[1300px] mx-auto pb-0">
      <LedgerMonthlySummary kind="sany" title="SANY Invoices" />
    </div>
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
        {
          key: '__machines',
          header: 'Detail',
          render: (r) => (
            <button
              type="button"
              onClick={() => setOpenInvoice(r)}
              className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
              style={{ color: 'var(--accent, var(--text-secondary))' }}
            >
              <List size={13} />
              Machines
            </button>
          ),
        },
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
    <SanyInvoiceLinesModal
      invoice={openInvoice}
      open={!!openInvoice}
      onClose={() => setOpenInvoice(null)}
    />
    </div>
  )
}
