/**
 * The machines behind one SANY invoice.
 *
 * A SANY proforma is a table of machines - 324 of them on the January to April
 * document - and the ledger only ever showed the one total, so the owner could
 * not check what they were paying for. This opens the document itself: every
 * machine line, what it is charged on, and whether the lines add up to the
 * gross the invoice states.
 *
 * Uses the shared Modal shell and the shared CostM3Table; it must not hand roll
 * either, or this panel drifts into a fourth table style and a fixed-size box.
 */
import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import Modal from '../ui/Modal'
import CostM3Table from './CostM3Table'
import { listSanyInvoiceLines } from '../../lib/api/costPerM3'
import {
  reconcileSanyLines, reconcileMessage, grossToNetRows, toSar,
  lineExportRows, LINE_EXPORT_COLUMNS, LINE_EXPORT_HEADERS,
} from '../../lib/sanyInvoiceLines'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

const usd = (v) => (v == null ? 'N/A' : `USD ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const int = (v) => (v == null ? '-' : Math.round(Number(v)).toLocaleString())
const text = (v) => (v == null || v === '' ? '-' : String(v))

const TONE = {
  match: { fg: 'var(--success, #16a34a)', bg: 'rgba(22,163,74,0.10)' },
  mismatch: { fg: 'var(--danger, #dc2626)', bg: 'rgba(220,38,38,0.10)' },
  neutral: { fg: 'var(--text-secondary)', bg: 'var(--surface-2, rgba(148,163,184,0.10))' },
}

export default function SanyInvoiceLinesModal({ invoice, open, onClose }) {
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const invoiceId = invoice?.id || null

  const load = useCallback(() => {
    if (!invoiceId) return undefined
    let cancelled = false
    setLoading(true); setError(''); setLines([])
    listSanyInvoiceLines(invoiceId)
      .then((rows) => { if (!cancelled) setLines(rows) })
      .catch((e) => { if (!cancelled) setError(toUserMessage(e, 'Could not load the machine lines for this invoice.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [invoiceId])

  useEffect(() => {
    if (!open || !invoiceId) return undefined
    return load()
  }, [open, invoiceId, load])

  const rate = invoice?.fx_rate == null ? null : Number(invoice.fx_rate)
  const rec = reconcileSanyLines(lines, invoice)
  const walk = grossToNetRows(invoice)
  // A read that failed must never be reported as "no detail loaded".
  const tone = error || loading ? TONE.neutral
    : rec.status === 'match' ? TONE.match
      : rec.status === 'mismatch' ? TONE.mismatch : TONE.neutral

  async function download() {
    setExporting(true)
    try {
      await exportToExcel(
        lineExportRows(lines, invoice),
        LINE_EXPORT_COLUMNS,
        LINE_EXPORT_HEADERS,
        reportFileName('SANY invoice machines', invoice?.invoice_no, invoice?.invoice_date),
        'Machines',
        {
          title: 'SANY invoice machine lines',
          currency: 'USD',
          meta: {
            'Quotation No': invoice?.invoice_no || 'N/A',
            'Invoice date': invoice?.invoice_date || 'N/A',
            'Contract': invoice?.description || 'N/A',
            'Gross USD': rec.gross == null ? 'N/A' : rec.gross,
            'Machine lines total USD': rec.linesTotal == null ? 'N/A' : rec.linesTotal,
            'Net payable USD': rec.net == null ? 'N/A' : rec.net,
            'Exchange rate used (SAR per USD)': rate == null ? 'N/A' : rate,
          },
        },
      )
    } catch (e) {
      setError(toUserMessage(e, 'Could not build the Excel file.'))
    } finally {
      setExporting(false)
    }
  }

  const columns = [
    { key: 'line_no', header: '#', align: 'right', width: '1%', render: (r) => int(r.line_no) },
    { key: 'machinery', header: 'Machinery', render: (r) => text(r.machinery) },
    { key: 'model', header: 'Model', render: (r) => text(r.model) },
    { key: 'charge_standard', header: 'Charge standard', render: (r) => text(r.charge_standard) },
    { key: 'contract_year', header: 'Contract year', render: (r) => text(r.contract_year) },
    { key: 'activation_date', header: 'Activated', render: (r) => text(r.activation_date) },
    { key: 'units', header: 'Units', align: 'right', render: (r) => int(r.units) },
    { key: 'usage_detail', header: 'Usage', align: 'right', render: (r) => text(r.usage_detail) },
    { key: 'amount_usd', header: 'Amount USD', align: 'right', render: (r) => usd(r.amount_usd) },
    {
      key: '__sar',
      header: 'Amount SAR',
      align: 'right',
      // Only when the invoice carries its own rate. A house rate applied to
      // someone else's document would be a figure nobody agreed.
      render: (r) => {
        const v = toSar(r.amount_usd, rate)
        return v == null ? 'N/A' : `SAR ${Math.round(v).toLocaleString()}`
      },
    },
  ]

  const foot = (
    <>
      <td className="px-3 py-2 font-semibold" colSpan={6} style={{ color: 'var(--text-primary)' }}>
        Total of {rec.count} machine lines
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>{int(rec.units)}</td>
      <td className="px-3 py-2" />
      <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: 'var(--text-primary)' }}>{usd(rec.linesTotal)}</td>
      <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: 'var(--text-primary)' }}>
        {toSar(rec.linesTotal, rate) == null ? 'N/A' : `SAR ${Math.round(toSar(rec.linesTotal, rate)).toLocaleString()}`}
      </td>
    </>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={`SANY invoice ${invoice?.invoice_no || ''} - machines`}
      subtitle={invoice?.description || invoice?.invoice_date || ''}
      headerExtra={(
        <button
          type="button"
          onClick={download}
          disabled={exporting || loading || !lines.length}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-subtle)] disabled:opacity-40"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Download size={14} />
          {exporting ? 'Preparing...' : 'Excel'}
        </button>
      )}
    >
      {error ? (
        <div className="rounded-lg p-4" style={{ background: 'rgba(220,38,38,0.10)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--danger, #dc2626)' }}>{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-subtle)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* The whole point of this panel: does the detail agree with the total. */}
          <div className="rounded-lg px-4 py-3" style={{ background: tone.bg }}>
            <p className="text-sm font-medium" style={{ color: tone.fg }}>
              {loading ? 'Loading the machine lines...' : reconcileMessage(rec, { currency: 'USD' })}
            </p>
          </div>

          {rec.status === 'no_lines' && !loading ? null : (
            <CostM3Table
              title="Machines on this invoice"
              columns={columns}
              rows={lines}
              rowKey="id"
              loading={loading}
              empty="No machine detail loaded for this invoice - the PDF has not been supplied."
              foot={foot}
              footnote={rate == null
                ? 'This invoice carries no exchange rate, so no SAR equivalent is shown.'
                : `SAR shown at the rate on this invoice, ${rate} SAR per USD.`}
            />
          )}

          {/* Gross, deductions, net - the figure the fleet is actually charged.
              VAT is not shown as a cost because it is recoverable. */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              What is actually paid
            </h3>
            {!walk.length ? (
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                This invoice records no gross, deductions or net amount.
              </p>
            ) : (
              <CostM3Table
                dense
                columns={[
                  { key: 'label', header: 'Line', render: (r) => r.label },
                  {
                    key: 'amountUsd',
                    header: 'USD',
                    align: 'right',
                    render: (r) => (
                      <span className={r.kind === 'net' ? 'font-bold' : r.kind === 'gross' ? 'font-semibold' : ''}>
                        {r.amountUsd == null ? 'Amount not recorded' : usd(r.amountUsd)}
                      </span>
                    ),
                  },
                  {
                    key: '__sar',
                    header: 'SAR',
                    align: 'right',
                    render: (r) => {
                      const v = toSar(r.amountUsd, rate)
                      return (
                        <span className={r.kind === 'net' ? 'font-bold' : ''}>
                          {v == null ? 'N/A' : `SAR ${Math.round(v).toLocaleString()}`}
                        </span>
                      )
                    },
                  },
                ]}
                rows={walk}
                rowKey="key"
                empty="No amounts recorded on this invoice."
                footnote="The Cost per M3 total counts the net figure, what Green Concrete actually pays. VAT is excluded because it is recoverable, so it is not a cost."
              />
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
