/**
 * ProfileMenu - identity, preferences and sign-out, in one place on the top bar.
 *
 * These controls used to sit loose in the sidebar footer (avatar, theme toggle,
 * bell, sign-out) and in its body (language). Collecting them behind the avatar
 * is what frees the sidebar to be navigation only, and it puts "who am I, where
 * am I working, how do I leave" in the one spot every web app puts it.
 *
 * Theme and language now live in the Preferences section here, so there is
 * exactly ONE home for them rather than a copy per shell.
 *
 * Honest rendering, throughout:
 *  - a CUSTOM role has no i18n entry, so `roles.Fleet Supervisor` would leak to
 *    the UI. roleLabel resolves and falls back to the plain role name.
 *  - the app version is shown only when system_config.app_version is actually
 *    set. A hardcoded version string would be a fabricated fact.
 *  - the working context is shown, never chosen, here. Changing it is
 *    WorkingContextSelector's job, and two controls writing one value is how
 *    they drift.
 *
 * Sign-out reuses AuthContext.signOut(), which already records the logout to the
 * audit trail BEFORE destroying the session and clears the user-scoped query /
 * service-worker / sessionStorage caches so the next account on the device
 * cannot see the previous one's data. This menu only adds the redirect to
 * /login, exactly as the sidebar footer did. Do NOT reimplement that teardown.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, User, HelpCircle, Info, MapPin, Building2 } from 'lucide-react'
import useAnchoredPopover from '../ui/useAnchoredPopover'
import ThemeToggle from '../ui/ThemeToggle'
import LanguageSwitcher from '../LanguageSwitcher'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { contextLabel } from '../../lib/workingContext'

/**
 * Translate with an honest English fallback. `t(key, vars)` takes interpolation
 * VARS second, not a fallback, so a key with no locale entry comes back as the
 * raw key. Same defence as roleLabel below, for the strings that are new here.
 */
function tx(t, key, fallback) {
  const v = typeof t === 'function' ? t(key) : undefined
  return !v || v === key ? fallback : v
}

/**
 * Translated role label. Mirrors Layout's own roleLabel: an admin-defined CUSTOM
 * role has no `roles.<name>` entry, and rendering the unresolved key is a bug
 * this app has actually shipped before.
 */
function roleLabel(t, role) {
  if (!role) return ''
  const key = `roles.${role}`
  const v = typeof t === 'function' ? t(key) : undefined
  return !v || v === key ? role : v
}

/** Role badge tones, matching the sidebar footer these controls came from. */
const ROLE_BADGE = {
  Admin: 'bg-red-900/40 text-red-300 border-red-700/30',
  Manager: 'bg-orange-900/40 text-orange-300 border-orange-700/30',
  Inspector: 'bg-purple-900/40 text-purple-300 border-purple-700/30',
  Director: 'bg-blue-900/40 text-blue-300 border-blue-700/30',
  'Tyre Man': 'bg-teal-900/40 text-teal-300 border-teal-700/30',
  'Integration Admin': 'bg-emerald-900/40 text-emerald-300 border-emerald-700/30',
  'Data Engineer': 'bg-cyan-900/40 text-cyan-300 border-cyan-700/30',
  Automation: 'bg-indigo-900/40 text-indigo-300 border-indigo-700/30',
}

function roleBadgeClass(role) {
  const tone = ROLE_BADGE[role] || 'bg-gray-800/60 text-gray-400 border-transparent'
  return `${tone} border text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap`
}

/** system_config values arrive JSON-encoded, so a plain string may be quoted. */
function plainConfig(value) {
  if (typeof value !== 'string') return ''
  const s = value.trim()
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) {
    try { return String(JSON.parse(s)) } catch { return s.slice(1, -1) }
  }
  return s
}

/**
 * @param {object}  props
 * @param {boolean} props.includePreferences  render the theme (and language) row (default true)
 * @param {boolean} props.showLanguage        put the language switcher in the menu.
 *                                            Set on MOBILE, where the top bar has
 *                                            no room for it; on desktop the bar
 *                                            carries it and duplicating it here
 *                                            would be a second control for one value.
 * @param {string}  props.className           extra classes on the avatar trigger
 */
export default function ProfileMenu({
  includePreferences = true,
  showLanguage = false,
  className = '',
}) {
  const { profile, signOut } = useAuth() || {}
  const { t } = useLanguage()
  const navigate = useNavigate()
  const settings = useSettings() || {}
  const { appSettings, systemConfig, workingContext } = settings

  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const rootRef = useRef(null)
  // nav:'menu' gives the panel the arrow-key model its role=menu advertises;
  // the hook owns it so all five shell menus behave identically.
  const { triggerRef, panelRef, coords } = useAnchoredPopover(open, {
    width: 268,
    height: 380,
    align: 'right',
    nav: 'menu',
    onRequestClose: () => setOpen(false),
  })

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      const inside = rootRef.current?.contains(e.target) || panelRef.current?.contains(e.target)
      if (!inside) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, panelRef])

  const name = profile?.full_name || profile?.username || 'User'
  const initial = (profile?.full_name?.[0] || profile?.username?.[0] || 'U').toUpperCase()
  const company = plainConfig(appSettings?.company_name) || appSettings?.company_name || 'TyrePulse'
  const appVersion = plainConfig(systemConfig?.app_version)
  const locationLabel = useMemo(
    () => (workingContext?.country ? contextLabel(workingContext) : ''),
    [workingContext],
  )

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      // signOut() audits the logout and clears user-scoped caches itself.
      await signOut?.()
      navigate('/login')
    } finally {
      setSigningOut(false)
      setOpen(false)
    }
  }

  const go = (to) => { setOpen(false); navigate(to) }

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${tx(t, 'shell.account', 'Account')}: ${name}`}
        title={name}
        className={`flex items-center gap-1 rounded-xl transition-colors hover:bg-green-400/10 ps-0.5 pe-1 py-0.5 ${className}`}
      >
        <span
          className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, #16a34a, #15803d)',
            boxShadow: '0 0 14px rgba(22,163,74,0.45)',
            border: '1px solid rgba(22,163,74,0.4)',
          }}
          aria-hidden="true"
        >
          {initial}
        </span>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--panel-ink-4)' }}
        />
      </button>

      {open && coords && createPortal(
        <div
          ref={panelRef}
          role="menu"
          aria-label={tx(t, 'shell.account', 'Account')}
          className="tp-popover w-[268px] p-0"
          style={{ top: coords.top, left: coords.left, maxHeight: coords.maxHeight }}
        >
          {/* ── Identity ──────────────────────────────────────────────────── */}
          <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-dim)' }}>
            <div className="flex items-start gap-2 min-w-0">
              <span
                className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}
                aria-hidden="true"
              >
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold truncate leading-tight" style={{ color: 'var(--text-primary)' }}>
                  {name}
                </p>
                {profile?.role && (
                  <span className={`inline-block mt-1 ${roleBadgeClass(profile.role)}`}>
                    {roleLabel(t, profile.role)}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-2 space-y-1">
              <p className="flex items-center gap-1.5 text-[11px] min-w-0" style={{ color: 'var(--text-muted)' }}>
                <Building2 size={11} aria-hidden="true" className="flex-shrink-0" />
                <span className="truncate">{company}</span>
              </p>
              {/* Shown, not chosen: this is a status line, and the one control
                  that writes it is WorkingContextSelector. */}
              {locationLabel && (
                <p className="flex items-center gap-1.5 text-[11px] min-w-0" style={{ color: 'var(--text-muted)' }}>
                  <MapPin size={11} aria-hidden="true" className="flex-shrink-0" style={{ color: '#16a34a' }} />
                  <span className="truncate">{locationLabel}</span>
                </p>
              )}
            </div>
          </div>

          {/* ── Actions ───────────────────────────────────────────────────── */}
          <div className="p-1.5">
            <MenuItem icon={User} label={tx(t, 'common.profile', 'Profile')} onClick={() => go('/settings')} />
            <MenuItem icon={HelpCircle} label={tx(t, 'common.help', 'Help')} onClick={() => go('/help')} />
          </div>

          {/* ── Preferences: the single home for theme and language ───────── */}
          {includePreferences && (
            <div className="px-3 py-2" style={{ borderTop: '1px solid var(--border-dim)' }}>
              <p
                className="text-[9.5px] font-bold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-dim)' }}
              >
                {tx(t, 'shell.preferences', 'Preferences')}
              </p>
              <div className="flex items-center justify-between gap-2 py-1">
                <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {tx(t, 'shell.theme', 'Theme')}
                </span>
                <ThemeToggle
                  size={13}
                  showLabel
                  className="inline-flex items-center gap-1.5 h-7 px-2 rounded-lg transition-colors hover:bg-[var(--input-bg)] text-[var(--text-secondary)]"
                />
              </div>
              {showLanguage && (
                <div className="flex items-center justify-between gap-2 py-1">
                  <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    {tx(t, 'common.language', 'Language')}
                  </span>
                  <LanguageSwitcher />
                </div>
              )}
            </div>
          )}

          {/* ── About: version only when it is genuinely configured ───────── */}
          <div className="px-3 py-2" style={{ borderTop: '1px solid var(--border-dim)' }}>
            <p className="flex items-start gap-1.5 text-[10.5px]" style={{ color: 'var(--text-dim)' }}>
              <Info size={11} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
              <span>
                {tx(t, 'shell.aboutApp', 'About TyrePulse')}
                {appVersion ? ` | v${appVersion}` : ''}
              </span>
            </p>
          </div>

          {/* ── Sign out ──────────────────────────────────────────────────── */}
          <div className="p-1.5" style={{ borderTop: '1px solid var(--border-dim)' }}>
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] text-start text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-60"
            >
              <LogOut size={14} aria-hidden="true" className="flex-shrink-0" />
              <span className="truncate">
                {signingOut
                  ? tx(t, 'shell.signingOut', 'Signing out...')
                  : tx(t, 'common.signOut', 'Sign out')}
              </span>
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] text-start transition-colors hover:bg-[var(--input-bg)]"
      style={{ color: 'var(--text-secondary)' }}
    >
      {Icon && <Icon size={14} aria-hidden="true" className="flex-shrink-0" style={{ color: 'var(--text-dim)' }} />}
      <span className="truncate">{label}</span>
    </button>
  )
}
