import { useState, useCallback, useEffect } from 'react'
import {
  X, Mail, Send, FileText, Plus, Trash2,
  CheckCircle, AlertCircle, Loader2, Users,
} from 'lucide-react'
import { sendReportEmail, generateReportPdf, buildFleetSummaryEmail } from '../lib/emailService'

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

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

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
        pdfBase64 = generateReportPdf(
          reportTitle,
          defaultPeriod,
          pdfColumns,
          pdfRows,
          Object.entries(kpiSummary).map(([k, v]) => [k, String(v)])
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
      setResult({ error: err.message || 'An unexpected error occurred. Please try again.' })
    } finally {
      setSending(false)
    }
  }

  // ── Handle backdrop click ─────────────────────────────────────────────────

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-modal-title"
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
              <Mail className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 id="email-modal-title" className="text-white font-semibold text-sm">Email Report</h2>
              <p className="text-gray-500 text-xs">{reportTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-300 transition-colors p-1 rounded-lg hover:bg-gray-800"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">

          {/* Subject */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium tracking-wide uppercase">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Report subject line"
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-gray-600 transition"
            />
          </div>

          {/* Recipients */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs text-gray-400 font-medium tracking-wide uppercase">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3 h-3" />
                  Recipients
                </span>
              </label>
              <span className="text-xs text-gray-600">
                {validRecipients.length} valid
              </span>
            </div>

            <div className="space-y-2">
              {recipients.map((r, i) => {
                const isDirty = r.length > 0
                const isValid = EMAIL_REGEX.test(r.trim())
                const showError = isDirty && !isValid

                return (
                  <div key={i} className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="email"
                        value={r}
                        onChange={(e) => updateRecipient(i, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); addRecipient() }
                        }}
                        placeholder="email@example.com"
                        className={`w-full bg-gray-800 border text-white text-sm rounded-lg px-3 py-2.5 outline-none placeholder-gray-600 transition
                          ${showError
                            ? 'border-red-700/80 focus:border-red-500 focus:ring-1 focus:ring-red-500/30'
                            : isDirty && isValid
                              ? 'border-green-700/60 focus:border-green-500 focus:ring-1 focus:ring-green-500/30'
                              : 'border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30'}`}
                        aria-invalid={showError}
                      />
                      {isDirty && (
                        <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${isValid ? 'text-green-500' : 'text-red-500'}`}>
                          {isValid ? '✓' : '✗'}
                        </span>
                      )}
                    </div>
                    {recipients.length > 1 && (
                      <button
                        onClick={() => removeRecipient(i)}
                        className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0 p-1"
                        aria-label="Remove recipient"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <button
              onClick={addRecipient}
              className="mt-2.5 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add recipient
            </button>
          </div>

          {/* PDF attachment toggle */}
          <div className={`flex items-center justify-between rounded-xl px-4 py-3 border transition
            ${!hasPdfData
              ? 'bg-gray-800/30 border-gray-700/30 opacity-50'
              : 'bg-gray-800/50 border-gray-700/50'}`}
          >
            <div className="flex items-center gap-2.5">
              <FileText className="w-4 h-4 text-gray-400" />
              <div>
                <span className="text-sm text-gray-300">Attach PDF report</span>
                {hasPdfData ? (
                  <p className="text-xs text-gray-600 mt-0.5">{pdfRows.length} rows · {pdfColumns.length} columns</p>
                ) : (
                  <p className="text-xs text-gray-600 mt-0.5">No data available for PDF</p>
                )}
              </div>
            </div>
            <button
              onClick={() => hasPdfData && setIncludePdf((v) => !v)}
              disabled={!hasPdfData}
              className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${includePdf && hasPdfData ? 'bg-blue-600' : 'bg-gray-700'}`}
              role="switch"
              aria-checked={includePdf && hasPdfData}
              aria-label="Toggle PDF attachment"
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${includePdf && hasPdfData ? 'translate-x-5' : 'translate-x-0.5'}`}
              />
            </button>
          </div>

          {/* KPI preview */}
          {Object.keys(kpiSummary).length > 0 && (
            <details className="group">
              <summary className="text-xs text-gray-500 hover:text-gray-400 cursor-pointer select-none transition-colors flex items-center gap-1.5 py-1">
                <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
                Email preview ({Object.keys(kpiSummary).length} KPIs included)
              </summary>
              <div className="mt-2 bg-gray-800/40 rounded-lg border border-gray-700/40 divide-y divide-gray-700/40 overflow-hidden text-xs">
                {Object.entries(kpiSummary).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-3 py-2">
                    <span className="text-gray-400">{k}</span>
                    <span className="text-gray-200 font-medium">{String(v)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Result messages */}
          {result?.success && (
            <div className="flex items-start gap-3 text-green-400 bg-green-900/20 border border-green-700/30 rounded-xl px-4 py-3">
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Report sent successfully</p>
                <p className="text-xs text-green-500/80 mt-0.5">
                  Delivered to {validRecipients.length} recipient{validRecipients.length !== 1 ? 's' : ''}.
                </p>
              </div>
            </div>
          )}

          {result?.error && (
            <div className="flex items-start gap-3 text-red-400 bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Failed to send report</p>
                <p className="text-xs text-red-400/80 mt-0.5">{result.error}</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-800 flex-shrink-0">
          <p className="text-xs text-gray-600">
            {validRecipients.length > 0
              ? `Sending to ${validRecipients.length} recipient${validRecipients.length !== 1 ? 's' : ''}`
              : 'Enter at least one valid email'}
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-600 px-4 py-2 rounded-lg transition-colors"
            >
              {result?.success ? 'Close' : 'Cancel'}
            </button>

            {!result?.success && (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send Report
                  </>
                )}
              </button>
            )}

            {result?.success && (
              <button
                onClick={() => {
                  setResult(null)
                  setRecipients([''])
                }}
                className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Send Another
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
