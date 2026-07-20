/**
 * SubscriptionGate — UX enforcement of the subscription-STATE access policy.
 *
 * Consumes the pure policy from `useBilling().subscriptionAccess`
 * (src/lib/subscriptionAccess.js) and shapes the app-wide UX for it:
 *
 *   - Renders a dismissible top BANNER whenever `banner` is set
 *     (amber = past_due, red = expired/suspended, gray = canceled).
 *   - When `!canUseApp` (expired / suspended) it replaces the app with a
 *     full-screen block that only offers "Go to billing" and "Sign out" — the
 *     rest of the app is out of reach. The `/billing` route itself is always
 *     allowed through so the user can pay to recover.
 *   - When `readOnly` but still `canUseApp` (canceled retention window) it only
 *     shows the banner and lets the user keep viewing.
 *
 * FAIL-OPEN, admin-safe by design:
 *   - Missing / not-loaded / unknown subscription state -> render children as
 *     normal (no banner, no block). The authoritative boundary is server-side
 *     RLS, not this client convenience gate.
 *   - Admins / super-admins are NEVER hard-blocked (they must reach billing to
 *     fix the account) — they only ever see the banner.
 *
 * This is a UX gate only. It intentionally does NOT block writes at the data
 * layer (that is RLS's job later). Non-destructive and reversible.
 */
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CreditCard, LogOut, AlertTriangle, X } from 'lucide-react'
import { useBilling } from '../hooks/useBilling'
import { useAuth } from '../contexts/AuthContext'

// Routes that must stay reachable even when the app is fully blocked, so the
// user can pay to reactivate or export. Kept minimal and prefix-matched.
const ALWAYS_ALLOWED_PREFIXES = ['/billing']

const BANNER_TONES = {
  amber: {
    bg: 'rgba(234,179,8,0.12)',
    border: 'rgba(234,179,8,0.35)',
    text: '#facc15',
  },
  red: {
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.35)',
    text: '#f87171',
  },
  gray: {
    bg: 'rgba(148,163,184,0.12)',
    border: 'rgba(148,163,184,0.35)',
    text: '#cbd5e1',
  },
}

function SubscriptionBanner({ tone, message, reason, onDismiss }) {
  const t = BANNER_TONES[tone] || BANNER_TONES.gray
  return (
    <div
      role="status"
      className="flex items-start gap-3 px-4 py-2.5 text-sm"
      style={{ background: t.bg, borderBottom: `1px solid ${t.border}`, color: t.text }}
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0 leading-snug">
        <span className="font-medium">{message}</span>
        {reason ? <span className="opacity-70"> {reason}</span> : null}
      </div>
      <Link
        to="/billing"
        className="flex-shrink-0 font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
      >
        Manage billing
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

function BlockScreen({ reason, onSignOut }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      style={{ background: 'var(--bg-base, #0a0f0d)' }}
      role="alertdialog"
      aria-modal="true"
      aria-label="Subscription required"
    >
      <div className="text-center max-w-md">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-5"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}
        >
          <CreditCard className="w-8 h-8" style={{ color: '#f87171' }} />
        </div>
        <h2 className="text-xl font-bold text-white mb-3">Subscription required</h2>
        <p className="text-gray-400 text-sm leading-relaxed mb-6">
          {reason || 'Access to the app is paused. Renew your subscription to restore access.'}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            to="/billing"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ background: '#16a34a' }}
          >
            <CreditCard className="w-4 h-4" />
            Go to billing
          </Link>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-300 border border-gray-700 hover:text-white hover:border-gray-500 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SubscriptionGate({ children }) {
  const [dismissed, setDismissed] = useState(false)
  const location = useLocation()
  const { subscriptionAccess } = useBilling()
  const { profile, isSuperAdmin, signOut } = useAuth()

  // FAIL-OPEN: if the policy did not resolve (billing not loaded, unknown
  // shape), never interfere with the app.
  if (!subscriptionAccess || typeof subscriptionAccess !== 'object') {
    return children
  }

  const { canUseApp, banner, reason } = subscriptionAccess

  const isAdmin = isSuperAdmin === true || profile?.role === 'Admin'
  const onAllowedRoute = ALWAYS_ALLOWED_PREFIXES.some(
    (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
  )

  // Hard block only for non-admins, when the policy says so, and only away from
  // the billing/recovery route. Admins pass through with the banner only.
  const shouldBlock = canUseApp === false && !isAdmin && !onAllowedRoute

  const showBanner = banner && banner.message && !dismissed

  if (shouldBlock) {
    return <BlockScreen reason={reason} onSignOut={signOut} />
  }

  return (
    <>
      {showBanner ? (
        <SubscriptionBanner
          tone={banner.tone}
          message={banner.message}
          reason={reason}
          onDismiss={() => setDismissed(true)}
        />
      ) : null}
      {children}
    </>
  )
}
