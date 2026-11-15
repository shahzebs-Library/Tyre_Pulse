/**
 * /invite/:token - join a company through an invitation link.
 *
 * Public page (no session needed). It reads the invitation with the anon RPC
 * get_invitation_preview (company name, code, role, whether an email is
 * required; never who sent it or who else is in the company), then signs up
 * with the token in the account metadata. The database decides the company,
 * the role and the approval (_signup_context in handle_new_user); this page
 * cannot choose any of them.
 *
 * Unaffected by single_tenant_mode and by the open-registration switch: an
 * invitation is an Admin's explicit act, and it names its own company.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, Building2, CheckCircle2, Loader2 } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'
import { getPublicConfig } from '../lib/api/systemConfig'
import { getInvitationPreview } from '../lib/api/orgInvitations'
import {
  buildInviteSignUp, inviteSignUpErrorKey, minPasswordLength,
  previewCompanyCode, signInIdFor, validateInviteForm,
} from '../lib/inviteSignup'
import TurnstileWidget, { captchaEnabled } from '../components/auth/TurnstileWidget'

const shell = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '24px 16px', background: 'var(--bg-base, #f8fafc)', color: 'var(--text-primary, #0f172a)',
}
const card = {
  width: '100%', maxWidth: 460, background: 'var(--surface, #ffffff)',
  border: '1px solid var(--border-bright, #e2e8f0)', borderRadius: 14, padding: 24,
}
const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }
const input = {
  width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 12px', fontSize: 15,
  borderRadius: 8, border: '1px solid var(--border-bright, #cbd5e1)',
  background: 'var(--surface, #ffffff)', color: 'inherit',
}
const help = { fontSize: 12, opacity: 0.75, margin: '4px 0 0' }
const primaryBtn = {
  width: '100%', minHeight: 46, borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 15,
  background: 'var(--brand, #15803d)', color: '#ffffff', cursor: 'pointer',
}

export default function InviteSignup() {
  const { token = '' } = useParams()
  const { t } = useLanguage()
  const k = (key, vars) => t(`auth.invite.${key}`, vars)

  const [preview, setPreview] = useState(null) // null = loading
  const [cfg, setCfg] = useState(null)
  const [form, setForm] = useState({ fullName: '', username: '', employeeId: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null) // { signInId, needsConfirm }
  const [captchaToken, setCaptchaToken] = useState(null)
  const captchaRef = useRef(null)
  const needsCaptcha = captchaEnabled()

  const load = useCallback(async () => {
    setPreview(null)
    setPreview(await getInvitationPreview(token))
  }, [token])

  useEffect(() => { load() }, [load])
  useEffect(() => { getPublicConfig().then(setCfg).catch(() => setCfg({})) }, [])

  const set = (field) => (e) => { setForm((f) => ({ ...f, [field]: e.target.value })); if (error) setError('') }

  async function handleSubmit(e) {
    e.preventDefault()
    const minLen = minPasswordLength(cfg)
    const problem = validateInviteForm(form, { emailRequired: preview?.email_required === true, minLen })
    if (problem) { setError(k(problem.key, problem.vars)); return }
    if (needsCaptcha && !captchaToken) { setError(k('errCaptcha')); return }
    setSubmitting(true); setError('')
    try {
      const req = buildInviteSignUp({ token, preview, form, captchaToken })
      const { data, error: authErr } = await supabase.auth.signUp(req)
      captchaRef.current?.reset()
      if (authErr) { setError(k(inviteSignUpErrorKey(authErr))); return }
      // The account was created inside the invited company. Do not keep a
      // session open from this page: the person signs in normally, which runs
      // every sign-in check (approval, lock, SSO, 2FA) in one place.
      if (data?.session) await supabase.auth.signOut().catch(() => {})
      setDone({ signInId: preview?.email_required ? req.email : signInIdFor(form.username, preview), needsConfirm: !data?.session && preview?.email_required === true })
    } catch {
      setError(k('errFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (preview === null) {
    return (
      <main style={shell}>
        <div style={card} role="status" aria-live="polite">
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <Loader2 size={18} className="animate-spin" aria-hidden="true" /> {k('checking')}
          </p>
        </div>
      </main>
    )
  }

  if (!preview.ok) {
    const reason = preview.reason || 'invalid'
    return (
      <main style={shell}>
        <div style={card} data-testid="invite-invalid">
          <h1 style={{ fontSize: 20, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={20} aria-hidden="true" /> {k('invalidTitle')}
          </h1>
          <p style={{ margin: '0 0 16px' }}>{k(`reason.${reason}`)}</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {reason === 'error' && <button type="button" onClick={load} style={{ ...primaryBtn, width: 'auto', padding: '0 18px' }}>{k('retry')}</button>}
            <Link to="/login" style={{ alignSelf: 'center' }}>{k('goToLogin')}</Link>
          </div>
        </div>
      </main>
    )
  }

  const company = preview.organisation_name || ''
  const code = previewCompanyCode(preview)

  if (done) {
    return (
      <main style={shell}>
        <div style={card} data-testid="invite-done">
          <h1 style={{ fontSize: 20, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={20} aria-hidden="true" /> {k('doneTitle')}
          </h1>
          <p style={{ margin: '0 0 8px' }}>{done.needsConfirm ? k('doneConfirmEmail') : k('doneBody', { id: done.signInId })}</p>
          {!done.needsConfirm && <p dir="ltr" style={{ fontFamily: 'monospace', margin: '0 0 16px' }}>{done.signInId}</p>}
          <Link to="/login" style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>{k('goToLogin')}</Link>
        </div>
      </main>
    )
  }

  return (
    <main style={shell}>
      <form style={card} onSubmit={handleSubmit} noValidate data-testid="invite-form">
        <h1 style={{ fontSize: 22, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={22} aria-hidden="true" /> {k('title', { company })}
        </h1>
        <p style={{ margin: '0 0 6px' }}>{k('subtitle', { company, role: preview.role || '' })}</p>
        {code && <p style={{ ...help, margin: '0 0 16px' }}>{k('codeLine', { code })}</p>}

        <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
          <div>
            <label htmlFor="inv-fullname" style={label}>{k('fullName')}</label>
            <input id="inv-fullname" autoComplete="name" style={input} value={form.fullName} onChange={set('fullName')} />
          </div>
          <div>
            <label htmlFor="inv-username" style={label}>{k('username')}</label>
            <input id="inv-username" autoComplete="username" dir="ltr" style={input} value={form.username} onChange={set('username')}
              aria-describedby="inv-username-help" autoCapitalize="none" spellCheck={false} />
            <p id="inv-username-help" style={help}>{k('usernameHelp')}</p>
          </div>
          <div>
            <label htmlFor="inv-empid" style={label}>{k('employeeId')}</label>
            <input id="inv-empid" style={input} value={form.employeeId} onChange={set('employeeId')} />
          </div>
          {preview.email_required && (
            <div>
              <label htmlFor="inv-email" style={label}>{k('email')}</label>
              <input id="inv-email" type="email" autoComplete="email" dir="ltr" style={input} value={form.email} onChange={set('email')}
                aria-describedby="inv-email-help" />
              <p id="inv-email-help" style={help}>{k('emailHelp')}</p>
            </div>
          )}
          <div>
            <label htmlFor="inv-password" style={label}>{k('password')}</label>
            <input id="inv-password" type="password" autoComplete="new-password" style={input} value={form.password} onChange={set('password')} />
          </div>
          <div>
            <label htmlFor="inv-confirm" style={label}>{k('confirm')}</label>
            <input id="inv-confirm" type="password" autoComplete="new-password" style={input} value={form.confirm} onChange={set('confirm')} />
          </div>
          {needsCaptcha && <TurnstileWidget ref={captchaRef} onToken={setCaptchaToken} onError={setError} />}
          {error && <p role="alert" style={{ margin: 0, color: 'var(--danger, #b91c1c)', fontSize: 14 }}>{error}</p>}
          <button type="submit" style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }} disabled={submitting}>
            {submitting ? k('submitting') : k('submit')}
          </button>
          <Link to="/login" style={{ textAlign: 'center', fontSize: 14 }}>{k('goToLogin')}</Link>
        </div>
      </form>
    </main>
  )
}
