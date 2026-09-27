import { useState, useCallback, useEffect } from 'react'
import {
  Mail, Send, FileText, Plus, Trash2,
  CheckCircle, AlertCircle, Loader2, Users, ChevronRight,
} from 'lucide-react'
import Modal from './ui/Modal'
import { sendReportEmail, generateReportPdf, buildFleetSummaryEmail } from '../lib/emailService'
import { useTenant } from '../contexts/TenantContext'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * EmailReportModal
 *
 * @param {object}  props
 * @param {boolean} props.isOpen        - Controls modal visibility
 * @param {function} props.onClose      - Called when the modal should close
 * @param {string}  props.reportTitle   - Human-readable report name
 * @param {string[]} props.pdfColumns   - Column headers for the PDF table
 * @param {(string|number)[][]} props.pdfRows - Data rows for the PDF table
 * @param {Record<string,string|number>} [props.kpiSummary] - KPI key/value pairs for summary table and email body
 * @param {string}  [props.period]      - Report period label, defaults to current month/year
 */
export default function EmailReportModal({
  isOpen,
  onClose,
  reportTitle = 'Fleet Report',
  pdfColumns = [],
  pdfRows = [],
  kpiSummary = {},
  period,
}) {
  const defaultPeriod = period ?? new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const { branding } = useTenant()
  const { appSettings } = useSettings()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [recipients, setRecipients] = useState([''])
  const [subject, setSubject] = useState('')
  const [includePdf, setIncludePdf] = useState(true)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null) // null | { success: true } | { error: string }

  // Reset state whenever the modal opens with a new report
  useEffect(() => {
    if (isOpen) {
      setRecipients([''])
      setSubject(`TyrePulse Report: ${reportTitle} - ${defaultPeriod}`)
      setIncludePdf(true)
      setResult(null)
      setSending(false)
    }
  }, [isOpen, reportTitle, defaultPeriod])

  // Escape, backdrop close and focus trapping come from the shared Modal shell.

  // ── Recipients management ─────────────────────────────────────────────────

  const addRecipient = useCallback(() => setRecipients((r) => [...r, '']), [])

  const removeRecipient = useCallback(
    (i) => setRecipients((r) => r.filter((_, idx) => idx !== i)),
    []
  )

  const updateRecipient = useCallback(
    (i, val) => setRecipients((r) => r.map((x, idx) => (idx === i ? val : x))),
    []
  )

  // ── Derived state ─────────────────────────────────────────────────────────

  const validRecipients = recipients.filter((r) => EMAIL_REGEX.test(r.trim()))
  const hasPdfData = pdfColumns.length > 0 && pdfRows.length > 0
  const canSend = validRecipients.length > 0 && subject.trim().length > 0 && !sending && !result?.success

  // ── Send handler ─────────────────────────────────────────────────────────

  async function handleSend() {
    if (!canSend) return
    setSending(true)
    setResult(null)

    try {
      let pdfBase64 = null
      if (includePdf && hasPdfData) {
        pdfBase64 = await generateReportPdf(
          reportTitle,
          defaultPeriod,
          pdfColumns,
          pdfRows,
          Object.entries(kpiSummary).map(([k, v]) => [k, String(v)]),
          { branding, company }
        )
      }

      const bodyHtml = buildFleetSummaryEmail(kpiSummary, `${reportTitle} - ${defaultPeriod}`)

      await sendReportEmail({
        to: validRecipients,
        subject: subject.trim(),
        bodyHtml,
        pdfBase64,
        pdfName: `${reportTitle.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.pdf`,
      })

      setResult({ success: true })
    } catch (err) {
      setResult({ error: toUserMessage(err, 'An unexpected error occurred. Please try again.') })
    } finally {
      setSending(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const recipientSummary = validRecipients.length > 0
    ? `Sending to ${validRecipients.length} recipient${validRecipients.length !== 1 ? 's' : ''}`
    : 'Enter at least one valid email'

  return (
    <Modal
      open={!!isOpen}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4 text-blue-500" aria-hidden="true" />
          </span>
          Email Report
        </span>
      }
      subtitle={reportTitle}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 w-full">
          <p className="text-xs text-[var(--text-muted)]" aria-live="polite">{recipientSummary}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm px-4 min-h-[44px]">
              {result?.success ? 'Close' : 'Cancel'}
            </button>
            {!result?.success && (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 min-h-[44px] rounded-lg transition-colors"
              >
                {sending
                  ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Sending...</>
                  : <><Send className="w-4 h-4" aria-hidden="true" /> Send Report</>}
              </button>
            )}
            {result?.success && (
              <button
                type="button"
                onClick={() => { setResult(null); setRecipients(['']) }}
                className="btn-secondary flex items-center gap-2 text-sm font-medium px-4 min-h-[44px]"
              >
                <Plus className="w-4 h-4" aria-hidden="true" /> Send Another
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="email-report-subject" className="block text-xs text-[var(--text-secondary)] mb-1.5 font-medium tracking-wide uppercase">
            Subject
          </label>
          <input
            id="email-report-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Report subject line"
            className="w-full min-h-[44px] bg-[var(--surface-2)] border text-[var(--text-primary)] text-sm rounded-lg px-3 py-2.5 outline-none transition border-[var(--border)] focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
          />
        </div>

        <div role="group" aria-labelledby="email-report-recipients">
          <div className="flex items-center justify-between mb-1.5">
            <span id="email-report-recipients" className="text-xs text-[var(--text-secondary)] font-medium tracking-wide uppercase flex items-center gap-1.5">
              <Users className="w-3 h-3" aria-hidden="true" /> Recipients
            </span>
            <span className="text-xs text-[var(--text-muted)]">{validRecipients.length} valid</span>
          </div>

          <div className="space-y-2">
            {recipients.map((r, i) => {
              const isDirty = r.length > 0
              const isValid = EMAIL_REGEX.test(r.trim())
              const showError = isDirty && !isValid
              return (
                <div key={i}>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="email"
                        value={r}
                        onChange={(e) => updateRecipient(i, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipient() } }}
                        placeholder="email@example.com"
                        aria-label={`Recipient ${i + 1} email`}
                        aria-invalid={showError}
                        className={`w-full min-h-[44px] bg-[var(--surface-2)] border text-[var(--text-primary)] text-sm rounded-lg px-3 py-2.5 outline-none transition pr-16
                          ${showError
                            ? 'border-red-500/80 focus:border-red-500 focus:ring-1 focus:ring-red-500/30'
                            : isDirty && isValid
                              ? 'border-green-500/60 focus:border-green-500 focus:ring-1 focus:ring-green-500/30'
                              : 'border-[var(--border)] focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30'}`}
                      />
                      {isDirty && (
                        <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${isValid ? 'text-green-500' : 'text-red-500'}`}>
                          {isValid ? 'Valid' : 'Invalid'}
                        </span>
                      )}
                    </div>
                    {recipients.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRecipient(i)}
                        className="text-[var(--text-muted)] hover:text-red-500 transition-colors flex-shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg"
                        aria-label={`Remove recipient ${i + 1}`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={addRecipient}
            className="mt-2 flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-400 transition-colors min-h-[44px]"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            Add recipient
          </button>
        </div>

        <div className={`flex items-center justify-between rounded-xl px-4 py-3 border border-[var(--border)] bg-[var(--surface-2)] transition ${!hasPdfData ? 'opacity-50' : ''}`}>
          <div className="flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
            <div>
              <span id="email-report-pdf-label" className="text-sm text-[var(--text-primary)]">Attach PDF report</span>
              {hasPdfData ? (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{pdfRows.length} rows · {pdfColumns.length} columns</p>
              ) : (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">No data available for PDF</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => hasPdfData && setIncludePdf((v) => !v)}
            disabled={!hasPdfData}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] flex-shrink-0"
            role="switch"
            aria-checked={includePdf && hasPdfData}
            aria-labelledby="email-report-pdf-label"
          >
            <span className={`w-11 h-6 rounded-full transition-colors relative block ${includePdf && hasPdfData ? 'bg-blue-600' : 'bg-[var(--border)]'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${includePdf && hasPdfData ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </span>
          </button>
        </div>

        {Object.keys(kpiSummary).length > 0 && (
          <details className="group">
            <summary className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer select-none transition-colors flex items-center gap-1.5 py-2">
              <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform" aria-hidden="true" />
              Email preview ({Object.keys(kpiSummary).length} KPIs included)
            </summary>
            <dl className="mt-2 bg-[var(--surface-2)] rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden text-xs">
              {Object.entries(kpiSummary).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-3 py-2">
                  <dt className="text-[var(--text-secondary)]">{k}</dt>
                  <dd className="text-[var(--text-primary)] font-medium">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}

        {result?.success && (
          <div role="status" className="flex items-start gap-3 text-[var(--text-primary)] bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3">
            <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-500" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">Report sent successfully</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Delivered to {validRecipients.length} recipient{validRecipients.length !== 1 ? 's' : ''}.
              </p>
            </div>
          </div>
        )}

        {result?.error && (
          <div role="alert" className="flex items-start gap-3 text-[var(--text-primary)] bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">Failed to send report</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">{result.error}</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
