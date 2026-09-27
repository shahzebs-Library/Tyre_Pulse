/**
 * EmailPdfButton - a small, reusable "email this report as-is" control.
 *
 * Renders a button + a recipient modal, then sends the report as a PDF ATTACHMENT
 * via the send-email edge function (sendReportEmail). The page supplies a `getPdf`
 * async factory that produces the EXACT PDF it would download, so the emailed
 * report is identical to the on-screen / downloaded one.
 *
 * @param {() => Promise<{ base64: string, filename?: string, subject?: string, bodyHtml?: string }>} getPdf
 * @param {boolean} [disabled]
 * @param {string}  [label]  button label (default "Email PDF")
 * @param {string}  [title]  button tooltip
 * @param {string}  [className]
 */
import { useState } from 'react'
import { Mail } from 'lucide-react'
import Modal from './ui/Modal'
import { sendReportEmail } from '../lib/emailService'
import { toUserMessage } from '../lib/safeError'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default function EmailPdfButton({
  getPdf,
  disabled = false,
  label = 'Email PDF',
  title = 'Email this report as a PDF attachment to chosen recipients',
  className = 'btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50',
}) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }

  async function send() {
    const recipients = to.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
    if (!recipients.length || !recipients.every(e => EMAIL_RE.test(e))) {
      setMsg({ ok: false, text: 'Enter one or more valid email addresses.' })
      return
    }
    setBusy(true); setMsg(null)
    try {
      const { base64, filename, subject, bodyHtml } = await getPdf()
      if (!base64) throw new Error('There is nothing to send for the current view.')
      await sendReportEmail({
        to: recipients,
        subject: subject || 'TyrePulse Report',
        bodyHtml: bodyHtml || '<p>Please find the attached report.</p>',
        pdfBase64: base64,
        pdfName: filename || 'tyrepulse-report.pdf',
      })
      setMsg({ ok: true, text: `Sent to ${recipients.length} recipient(s).` })
    } catch (e) {
      setMsg({ ok: false, text: `Could not send: ${toUserMessage(e, 'email failed')}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setMsg(null) }} disabled={disabled} className={className} title={title}>
        <Mail size={14} aria-hidden="true" /> {label}
      </button>
      <Modal
        open={open}
        onClose={() => { if (!busy) setOpen(false) }}
        closeOnBackdrop={!busy}
        size="sm"
        title={<span className="inline-flex items-center gap-2"><Mail size={15} aria-hidden="true" /> Email report</span>}
        subtitle="The exact report you see here is attached as a PDF and sent right away."
        footer={
          <div className="flex items-center gap-2 w-full">
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn-secondary flex-1 text-sm px-3 min-h-[44px]">Cancel</button>
            <button type="button" onClick={send} disabled={busy || !to.trim()} className="btn-primary flex-1 flex items-center justify-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-50">
              {busy
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" aria-hidden="true" /> Sending...</>
                : <><Mail size={14} aria-hidden="true" /> Send now</>}
            </button>
          </div>
        }
      >
        <label htmlFor="email-pdf-recipients" className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Recipients</label>
        <input id="email-pdf-recipients" autoFocus type="text" value={to}
          onChange={(e) => { setTo(e.target.value); setMsg(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy && to.trim()) { e.preventDefault(); send() } }}
          placeholder="name@company.com, another@company.com"
          aria-describedby="email-pdf-hint"
          className="w-full min-h-[44px] rounded-lg px-3 text-sm bg-[var(--surface-2)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]" />
        <p id="email-pdf-hint" className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Separate addresses with a comma, semicolon or space.</p>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-xs mt-2 ${msg.ok ? 'text-green-500' : 'text-red-500'}`}>{msg.text}</p>}
      </Modal>
    </>
  )
}
