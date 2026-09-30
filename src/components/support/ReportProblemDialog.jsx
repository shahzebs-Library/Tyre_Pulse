/**
 * ReportProblemDialog - "Report a problem" (Problem Tracking, Phase 1).
 *
 * One sentence, a type, an optional severity. Page, browser, OS and app version
 * are attached automatically, and the server attaches the person's own recent
 * error logs. Deliberately independent of AuthContext and the router so it can
 * also open from the page ErrorBoundary, where those may be the thing that broke.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Send } from 'lucide-react'
import Modal from '../ui/Modal'
import {
  ISSUE_CATEGORIES, ISSUE_SEVERITIES, DESCRIPTION_MAX, validateIssueInput,
} from '../../lib/problemReport'
import { submitUserIssue, currentWebContext } from '../../lib/api/userIssues'

const FIELD = {
  width: '100%', borderRadius: 10, padding: '9px 11px', fontSize: 13,
  background: 'var(--input-bg)', color: 'var(--text-primary)',
  border: '1px solid var(--border-dim)',
}

export default function ReportProblemDialog({ open, onClose, referenceId = null, submit = submitUserIssue }) {
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(referenceId ? 'bug' : '')
  const [severity, setSeverity] = useState('medium')
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    if (!open) return
    setDescription(''); setCategory(referenceId ? 'bug' : ''); setSeverity('medium')
    setErrors({}); setServerError(''); setBusy(false); setDone(null)
  }, [open, referenceId])

  const ctx = open ? currentWebContext() : null

  async function onSubmit(e) {
    e?.preventDefault?.()
    if (busy) return
    const check = validateIssueInput({ description, category, severity })
    setErrors(check.errors)
    if (!check.ok) return
    setBusy(true); setServerError('')
    try {
      const res = await submit({ ...check.value, referenceId, context: ctx })
      setDone(res || { linkedLogs: 0 })
    } catch (err) {
      setServerError(err?.message || 'Your report could not be sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const footer = done ? (
    <button type="button" onClick={onClose}
      style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: '#15803d', color: '#fff', fontSize: 13, fontWeight: 700 }}>
      Close
    </button>
  ) : (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
      <button type="button" onClick={onClose} disabled={busy}
        style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border-dim)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13 }}>
        Cancel
      </button>
      <button type="submit" form="tp-report-problem" disabled={busy}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 10, border: 'none', background: '#15803d', color: '#fff', fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
        <Send size={14} aria-hidden="true" />
        {busy ? 'Sending...' : 'Send report'}
      </button>
    </div>
  )

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} size="md" title="Report a problem"
      subtitle="Tell us in one sentence what went wrong. We attach the technical details for you."
      footer={footer}>
      {done ? (
        <div role="status" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <CheckCircle2 size={20} aria-hidden="true" style={{ color: '#16a34a', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <p style={{ margin: 0, color: 'var(--text-primary)', fontWeight: 600 }}>Thank you. Your report was sent.</p>
            <p style={{ margin: '4px 0 0' }}>
              An administrator will look at it. You will get a message here when it is fixed.
              {done.linkedLogs > 0 ? ` We attached ${done.linkedLogs} recent error record${done.linkedLogs === 1 ? '' : 's'} from your session.` : ''}
            </p>
          </div>
        </div>
      ) : (
        <form id="tp-report-problem" onSubmit={onSubmit} noValidate style={{ display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>What went wrong?</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESCRIPTION_MAX}
              rows={3}
              aria-invalid={errors.description ? 'true' : undefined}
              aria-describedby={errors.description ? 'tp-rp-desc-err' : undefined}
              placeholder="For example: the Save button on the inspection form does nothing."
              style={{ ...FIELD, resize: 'vertical' }}
            />
            {errors.description && <span id="tp-rp-desc-err" role="alert" style={{ color: '#ef4444', fontSize: 12 }}>{errors.description}</span>}
          </label>

          <label style={{ display: 'grid', gap: 5, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>What kind of problem is it?</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              aria-invalid={errors.category ? 'true' : undefined}
              aria-describedby={errors.category ? 'tp-rp-cat-err' : undefined}
              style={FIELD}>
              <option value="">Choose one</option>
              {ISSUE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            {errors.category && <span id="tp-rp-cat-err" role="alert" style={{ color: '#ef4444', fontSize: 12 }}>{errors.category}</span>}
          </label>

          <label style={{ display: 'grid', gap: 5, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>How much does it affect your work? (optional)</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={FIELD}>
              {ISSUE_SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>

          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, borderTop: '1px solid var(--border-dim)', paddingTop: 10 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>Sent with your report</p>
            <p style={{ margin: '2px 0 0' }}>
              Page: {ctx?.page || 'Not available'} | Browser: {ctx?.device || 'Not available'} | System: {ctx?.os || 'Not available'} | App version: {ctx?.app_version || 'Not available'}
              {referenceId ? ` | Reference: ${referenceId}` : ''}
            </p>
            <p style={{ margin: '2px 0 0' }}>Your name and company are taken from your sign-in. No screenshot is sent.</p>
          </div>

          {serverError && <p role="alert" style={{ margin: 0, color: '#ef4444', fontSize: 12.5 }}>{serverError}</p>}
        </form>
      )}
    </Modal>
  )
}
