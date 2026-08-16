/**
 * TopBar - the app's global control strip.
 *
 * Until now this app had NO desktop top bar: search, country, language, theme,
 * notifications, profile and sign-out were all crammed into a 240px sidebar that
 * also carries ~210 nav items. The sidebar's job is navigation; global controls
 * belong on a horizontal bar where they have room and a stable position. This is
 * that bar, for both desktop and mobile.
 *
 * It OWNS no engine. Search opens the existing command palette, notifications
 * are the existing NotificationCenter, theme is the existing ThemeToggle,
 * language the existing LanguageSwitcher. A second search or notification
 * implementation would be the thing to avoid, not the thing to build.
 *
 * Desktop:  [collapse] [brand] .. [search] [+ create] [context] [lang] [bell] [help] [me]
 * Mobile:   [menu] [brand] [context chip] [search] [bell] [me]
 *
 * On mobile the keyboard hint is dropped (there is no keyboard to hint at) and
 * language moves inside ProfileMenu, because a 360px bar cannot carry six
 * controls and stay tappable. The create menu is desktop-only for the same
 * reason, and hides itself entirely for anyone with fewer than two creation
 * destinations - see GlobalCreate.
 *
 * Height is 52px so it lines up exactly with the sidebar's own logo row.
 * Colours come from CSS vars (--panel-deep / --panel-ink-*) which flip with
 * `html.light`, so the bar reads correctly in both themes without a second
 * palette.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Menu,
  Search,
  Bell,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  Keyboard,
  Activity,
  Info,
} from 'lucide-react'
import BrandIcon from '../ui/BrandIcon'
import ThemeToggle from '../ui/ThemeToggle'
import NotificationCenter from '../NotificationCenter'
import LanguageSwitcher from '../LanguageSwitcher'
import useAnchoredPopover from '../ui/useAnchoredPopover'
import WorkingContextSelector from './WorkingContextSelector'
import GlobalCreate from './GlobalCreate'
import ProfileMenu from './ProfileMenu'
import { useCommandPalette } from '../../contexts/CommandPaletteContext'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'

/**
 * Translate with an honest English fallback. `t(key, vars)` takes interpolation
 * VARS second, not a fallback, so a key with no locale entry comes back as the
 * raw key - the same way "roles.Fleet Supervisor" once leaked onto the sidebar.
 */
function tx(t, key, fallback) {
  const v = typeof t === 'function' ? t(key) : undefined
  return !v || v === key ? fallback : v
}

/** Mac shows the command glyph, everything else spells Ctrl. */
function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  const s = `${navigator.platform || ''} ${navigator.userAgent || ''}`
  return /Mac|iPhone|iPad|iPod/i.test(s)
}

const BAR_HEIGHT = 52

/**
 * @param {object}   props
 * @param {Function} props.onToggleSidebar  collapse/expand (desktop) or open drawer (mobile)
 * @param {boolean}  props.sidebarOpen      current sidebar state, drives the toggle icon + label
 * @param {boolean}  props.isMobile         renders the compact mobile bar
 * @param {number}   props.alertCount       unread alert count for the bell badge (mobile bell)
 * @param {string}   props.appIcon          resolved brand mark src (tenant logo or bundled default)
 * @param {boolean}  props.hasCustomIcon    true when appIcon is a tenant logo (BrandIcon chips it)
 */
export default function TopBar({
  onToggleSidebar,
  sidebarOpen = true,
  isMobile = false,
  alertCount = 0,
  appIcon,
  hasCustomIcon = false,
}) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const palette = useCommandPalette()
  const setCmdOpen = palette?.setOpen

  const isMac = useMemo(isMacPlatform, [])
  const searchLabel = tx(t, 'shell.searchScope', 'Search asset, tyre, serial, WO, claim...')

  const openSearch = () => setCmdOpen?.(true)

  const toggleTitle = isMobile
    ? tx(t, 'shell.openMenu', 'Open menu')
    : sidebarOpen
      ? tx(t, 'shell.collapseSidebar', 'Collapse sidebar')
      : tx(t, 'shell.expandSidebar', 'Expand sidebar')

  const ToggleIcon = isMobile ? Menu : sidebarOpen ? PanelLeftClose : PanelLeftOpen

  return (
    <header
      role="banner"
      className="flex-shrink-0 sticky top-0 z-30 flex items-center gap-2 px-2.5 sm:px-3"
      style={{
        height: BAR_HEIGHT,
        background: 'var(--panel-deep)',
        borderBottom: '1px solid rgba(22,163,74,0.12)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Sidebar control. On mobile it opens the drawer; on desktop it collapses
          the rail, which is where that control used to live inside the sidebar. */}
      <button
        type="button"
        onClick={() => onToggleSidebar?.()}
        title={toggleTitle}
        aria-label={toggleTitle}
        aria-expanded={isMobile ? undefined : sidebarOpen}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl transition-colors hover:text-green-400 hover:bg-green-400/10"
        style={{
          color: 'var(--panel-ink-3)',
          background: 'rgba(22,163,74,0.06)',
          border: '1px solid rgba(22,163,74,0.12)',
        }}
      >
        <ToggleIcon size={16} aria-hidden="true" />
      </button>

      {/* Brand. Below 640px the wordmark drops and the mark carries the brand
          alone: a 360px bar has to fit menu, brand, context, search, bell and
          avatar, and the mark is the part that stays recognisable when small. */}
      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
        <BrandIcon src={appIcon} custom={hasCustomIcon} size={isMobile ? 20 : 18} className="flex-shrink-0" />
        <span className="tp-wordmark font-extrabold text-sm tracking-tight hidden sm:inline">
          TyrePulse
        </span>
      </div>

      {/* ── Desktop: wide search trigger carrying its keyboard hint ─────────── */}
      {!isMobile && (
        <button
          type="button"
          onClick={openSearch}
          aria-label={searchLabel}
          className="ml-2 flex items-center gap-2 h-8 px-3 rounded-xl min-w-0 flex-1 max-w-md text-xs transition-colors hover:text-green-400 group"
          style={{
            color: 'var(--panel-ink-3)',
            background: 'rgba(22,163,74,0.04)',
            border: '1px solid rgba(22,163,74,0.1)',
          }}
        >
          <Search size={13} aria-hidden="true" className="flex-shrink-0" />
          <span className="flex-1 text-left font-medium truncate">{searchLabel}</span>
          <kbd
            aria-hidden="true"
            className="flex-shrink-0 text-[9.5px] px-1.5 py-0.5 rounded-md font-mono font-semibold"
            style={{
              color: 'var(--panel-ink-4)',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(127,127,127,0.18)',
            }}
          >
            {isMac ? 'Cmd K' : 'Ctrl K'}
          </kbd>
        </button>
      )}

      {/* Spacer pushes the control cluster right. On mobile it also lets the
          context chip take whatever room is left over. */}
      <div className={isMobile ? 'flex-1 min-w-0 flex justify-end' : 'flex-1'}>
        {isMobile && <WorkingContextSelector compact />}
      </div>

      {/* ── Right cluster ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {!isMobile && (
          <>
            {/* Secondary by design: GlobalCreate renders NOTHING unless the user
                has at least two creation destinations they can actually reach,
                so most roles never see it and the bar stays uncrowded. */}
            <GlobalCreate />
            <WorkingContextSelector />
            <div className="w-px h-5 mx-0.5" style={{ background: 'rgba(127,127,127,0.2)' }} aria-hidden="true" />
            <LanguageSwitcher />
            <ThemeToggle
              size={14}
              className="w-8 h-8 flex items-center justify-center rounded-xl transition-colors hover:text-green-400 hover:bg-green-400/10"
            />
            <NotificationCenter />
            <HelpMenu />
          </>
        )}

        {isMobile && (
          <>
            <button
              type="button"
              onClick={openSearch}
              aria-label={searchLabel}
              className="w-8 h-8 flex items-center justify-center rounded-xl transition-colors active:text-green-400"
              style={{ color: 'var(--panel-ink-3)' }}
            >
              <Search size={16} aria-hidden="true" />
            </button>
            {/* Mobile keeps a plain bell that routes to the Alerts page rather
                than a dropdown: a 320px popover of notifications is unusable. */}
            <button
              type="button"
              onClick={() => navigate('/alerts')}
              aria-label={`${tx(t, 'shell.alerts', 'Alerts')}${alertCount > 0 ? ` (${alertCount})` : ''}`}
              className="relative w-8 h-8 flex items-center justify-center rounded-xl transition-colors active:text-green-400"
              style={{ color: 'var(--panel-ink-3)' }}
            >
              <Bell size={16} aria-hidden="true" />
              {alertCount > 0 && (
                <span
                  className="absolute top-0.5 right-0.5 min-w-[14px] h-3.5 flex items-center justify-center text-[9px] font-bold bg-red-600 text-white rounded-full px-0.5"
                  style={{ boxShadow: '0 0 6px rgba(239,68,68,0.7)' }}
                >
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </button>
          </>
        )}

        {/* Language and theme live inside this menu on mobile. */}
        <ProfileMenu includePreferences showLanguage={isMobile} />
      </div>
    </header>
  )
}

/* ── Help menu ────────────────────────────────────────────────────────────────
   Only links to routes that genuinely exist. `/system-health` is Admin-gated by
   its route, so it is offered only to an Admin or super-admin: an item that
   lands on Access Denied is worse than an item that is not there. Keyboard
   Shortcuts opens the command palette, which is where the app's shortcuts are
   discoverable today, rather than promising a cheat-sheet screen nobody built. */

function HelpMenu() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { profile, isSuperAdmin } = useAuth() || {}
  const { systemConfig } = useSettings() || {}
  const palette = useCommandPalette()

  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const popRef = useRef(null)
  const { triggerRef, coords } = useAnchoredPopover(open, { width: 236, height: 220, align: 'right' })

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      const inside = rootRef.current?.contains(e.target) || popRef.current?.contains(e.target)
      if (!inside) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const canSeeStatus = isSuperAdmin === true || profile?.role === 'Admin'
  // Rendered only when actually configured; a hardcoded number would be a lie.
  const appVersion = typeof systemConfig?.app_version === 'string'
    ? systemConfig.app_version.replace(/^"|"$/g, '')
    : ''

  const items = [
    {
      key: 'help',
      icon: BookOpen,
      label: tx(t, 'shell.helpCenter', 'Help Center'),
      onClick: () => navigate('/help'),
    },
    {
      key: 'shortcuts',
      icon: Keyboard,
      label: tx(t, 'shell.shortcuts', 'Keyboard Shortcuts'),
      onClick: () => palette?.setOpen?.(true),
    },
    canSeeStatus && {
      key: 'status',
      icon: Activity,
      label: tx(t, 'shell.systemStatus', 'System Status'),
      onClick: () => navigate('/system-health'),
    },
  ].filter(Boolean)

  const label = tx(t, 'common.help', 'Help')

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="w-8 h-8 flex items-center justify-center rounded-xl transition-colors hover:text-green-400 hover:bg-green-400/10"
        style={{ color: 'var(--panel-ink-3)' }}
      >
        <HelpCircle size={15} aria-hidden="true" />
      </button>

      {open && coords && createPortal(
        <div
          ref={popRef}
          role="menu"
          aria-label={label}
          className="tp-popover w-[236px] p-1.5"
          style={{ top: coords.top, left: coords.left, maxHeight: coords.maxHeight }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onClick() }}
              className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] text-left transition-colors hover:bg-[var(--input-bg)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              <item.icon size={14} aria-hidden="true" className="flex-shrink-0" style={{ color: 'var(--text-dim)' }} />
              <span className="truncate">{item.label}</span>
            </button>
          ))}

          <div className="my-1 h-px" style={{ background: 'var(--border-dim)' }} />
          <div className="px-3 py-1.5 flex items-start gap-2.5">
            <Info size={14} aria-hidden="true" className="flex-shrink-0 mt-0.5" style={{ color: 'var(--text-dim)' }} />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                {tx(t, 'shell.aboutApp', 'About TyrePulse')}
              </p>
              <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                {tx(t, 'shell.fleetIntelligence', 'Fleet Intelligence')}
                {appVersion ? ` | v${appVersion}` : ''}
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
