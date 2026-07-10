import { useState, useMemo, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, ClipboardCheck, ScanLine, Layers, Wrench, Bell,
  BarChart2, FileText, Users, Sparkles, Globe, ArrowRight, ArrowLeft,
  Check, X, ShieldCheck, MapPin, Rocket, Boxes, Truck,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useSettings, COUNTRIES, COUNTRY_LABEL, COUNTRY_CURRENCY } from '../contexts/SettingsContext'
import { Illustration } from './illustrations'

/**
 * Role-based onboarding wizard.
 *
 * First-run guided tour that adapts its content, capabilities and primary
 * destination to the signed-in user's role. Includes an inline country
 * selection step for admins / users without a locked country so multi-country
 * fleets land in the right data scope from day one.
 *
 * Persistence is per-user (localStorage `tp_onboarded_v1_<userId>`) so a shared
 * device shows the tour once per account. The tour can be replayed on demand via
 * the `tp:onboarding:replay` window event (wired from Settings).
 */

const ONBOARD_KEY = (uid) => `tp_onboarded_v1_${uid || 'anon'}`

// Per-role tour content. Keys map to the normalised `profile.role` values.
const ROLE_CONTENT = {
  Admin: {
    tagline: 'Full control of the fleet intelligence platform.',
    accent: '#16a34a',
    icon: ShieldCheck,
    capabilities: [
      'Manage users, roles and module permissions',
      'Configure organisations, countries and settings',
      'Full access to every analytics and intelligence workspace',
      'Approve data uploads and review the audit trail',
    ],
    primary: { to: '/', label: 'Go to Dashboard', icon: LayoutDashboard },
    features: [
      { to: '/users', label: 'User Management', icon: Users, desc: 'Create & approve accounts' },
      { to: '/upload', label: 'Data Intake', icon: Boxes, desc: 'Import fleet & tyre data' },
      { to: '/executive-report', label: 'Executive Report', icon: FileText, desc: 'Board-ready insights' },
      { to: '/settings', label: 'Settings', icon: ShieldCheck, desc: 'Platform configuration' },
    ],
  },
  Manager: {
    tagline: 'Run day-to-day operations and keep the fleet healthy.',
    accent: '#16a34a',
    icon: LayoutDashboard,
    capabilities: [
      'Monitor live fleet status and daily operations',
      'Manage work orders, stock and corrective actions',
      'Track KPIs, costs and tyre performance',
      'Review inspections and act on alerts',
    ],
    primary: { to: '/', label: 'Go to Dashboard', icon: LayoutDashboard },
    features: [
      { to: '/live-fleet', label: 'Live Fleet', icon: Truck, desc: 'Real-time status' },
      { to: '/work-orders', label: 'Work Orders', icon: Wrench, desc: 'Workshop pipeline' },
      { to: '/kpi', label: 'KPI Scorecard', icon: BarChart2, desc: 'Performance metrics' },
      { to: '/alerts', label: 'Alerts', icon: Bell, desc: 'Critical issues' },
    ],
  },
  Director: {
    tagline: 'Executive oversight across the whole operation.',
    accent: '#16a34a',
    icon: BarChart2,
    capabilities: [
      'Executive dashboards and country comparisons',
      'Cost, budget and forecasting intelligence',
      'Fleet-wide KPIs and performance benchmarks',
      'Strategic reporting for decision-making',
    ],
    primary: { to: '/', label: 'Go to Dashboard', icon: LayoutDashboard },
    features: [
      { to: '/executive-report', label: 'Executive Report', icon: FileText, desc: 'Strategic summary' },
      { to: '/country-comp', label: 'Country Comparison', icon: Globe, desc: 'Cross-market view' },
      { to: '/forecasting', label: 'Forecasting', icon: Sparkles, desc: 'Budget & demand' },
      { to: '/kpi-command', label: 'KPI Command', icon: BarChart2, desc: 'Fleet metrics' },
    ],
  },
  Inspector: {
    tagline: 'Field inspections, tyre records and fleet checks.',
    accent: '#16a34a',
    icon: ClipboardCheck,
    capabilities: [
      'Record tyre inspections in the field',
      'Scan tyres and vehicles by QR / barcode',
      'Raise corrective actions and accident reports',
      'Track alerts and daily operational tasks',
    ],
    primary: { to: '/inspections', label: 'Start Inspecting', icon: ClipboardCheck },
    features: [
      { to: '/inspections', label: 'Inspections', icon: ClipboardCheck, desc: 'Record checks' },
      { to: '/scan', label: 'Scan', icon: ScanLine, desc: 'QR / barcode lookup' },
      { to: '/tyres', label: 'Tyre Records', icon: Layers, desc: 'Browse fleet tyres' },
      { to: '/alerts', label: 'Alerts', icon: Bell, desc: 'Critical issues' },
    ],
  },
  'Tyre Man': {
    tagline: 'Your field workspace for inspections and tyre changes.',
    accent: '#16a34a',
    icon: ClipboardCheck,
    capabilities: [
      'Complete tyre inspection checklists offline',
      'Scan tyres and vehicles instantly',
      'Log tyre changes and workshop work orders',
      'Work offline — everything syncs when you reconnect',
    ],
    primary: { to: '/inspections', label: 'Open Checklist', icon: ClipboardCheck },
    features: [
      { to: '/inspections', label: 'Checklist', icon: ClipboardCheck, desc: 'Inspect tyres' },
      { to: '/scan', label: 'Scan', icon: ScanLine, desc: 'Fast lookup' },
      { to: '/tyres', label: 'Records', icon: Layers, desc: 'Tyre history' },
      { to: '/work-orders', label: 'Work Orders', icon: Wrench, desc: 'Workshop jobs' },
    ],
  },
  Reporter: {
    tagline: 'Analytics and reporting across the fleet.',
    accent: '#16a34a',
    icon: FileText,
    capabilities: [
      'Build and export fleet reports',
      'Review KPI scorecards and analytics',
      'Track executive-level performance',
      'Browse tyre records and history',
    ],
    primary: { to: '/reports', label: 'Open Reports', icon: FileText },
    features: [
      { to: '/reports', label: 'Reports', icon: FileText, desc: 'Generate & export' },
      { to: '/analytics', label: 'Analytics', icon: BarChart2, desc: 'Trends & charts' },
      { to: '/kpi', label: 'KPI Scorecard', icon: BarChart2, desc: 'Metrics' },
      { to: '/executive-report', label: 'Executive', icon: Sparkles, desc: 'Roll-up view' },
    ],
  },
  Driver: {
    tagline: 'Your vehicle status and inspection reports.',
    accent: '#16a34a',
    icon: Truck,
    capabilities: [
      'View your vehicle dashboard',
      'Submit and review inspections',
      'Stay on top of alerts for your vehicle',
    ],
    primary: { to: '/', label: 'Go to Dashboard', icon: LayoutDashboard },
    features: [
      { to: '/inspections', label: 'Inspections', icon: ClipboardCheck, desc: 'Your checks' },
      { to: '/alerts', label: 'Alerts', icon: Bell, desc: 'Vehicle issues' },
    ],
  },
}

const FALLBACK = ROLE_CONTENT.Inspector

export function hasCompletedOnboarding(userId) {
  try { return localStorage.getItem(ONBOARD_KEY(userId)) === '1' }
  catch { return true }
}

export default function OnboardingWizard() {
  const { profile, user } = useAuth()
  const { t } = useLanguage()
  const { activeCountry, setActiveCountry } = useSettings()
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  const role = profile?.role
  const content = (role && ROLE_CONTENT[role]) || FALLBACK
  const RoleIcon = content.icon

  // A user has a locked country when they are non-admin with an assigned country.
  const lockedCountry = useMemo(() => {
    if (!profile) return null
    if (profile.role === 'Admin') return null
    const c = Array.isArray(profile.country) ? profile.country[0] : profile.country
    return c && String(c).trim() ? String(c).trim() : null
  }, [profile])

  const showCountryStep = !lockedCountry // admins & unassigned users choose scope

  // Decide whether to auto-open on first run once the profile is loaded.
  useEffect(() => {
    if (!profile || !user) return
    if (!hasCompletedOnboarding(user.id)) {
      setStep(0)
      setOpen(true)
    }
  }, [profile, user])

  // Allow replay from anywhere (Settings → "Replay tour").
  useEffect(() => {
    const replay = () => { setStep(0); setOpen(true) }
    window.addEventListener('tp:onboarding:replay', replay)
    return () => window.removeEventListener('tp:onboarding:replay', replay)
  }, [])

  const steps = useMemo(() => {
    const base = ['welcome', 'role']
    if (showCountryStep) base.push('country')
    base.push('features', 'finish')
    return base
  }, [showCountryStep])

  const finish = useCallback((navigateTo) => {
    try { localStorage.setItem(ONBOARD_KEY(user?.id), '1') } catch { /* ignore */ }
    setOpen(false)
    if (navigateTo) navigate(navigateTo)
  }, [user, navigate])

  const next = () => setStep(s => Math.min(s + 1, steps.length - 1))
  const back = () => setStep(s => Math.max(s - 1, 0))

  if (!open || !profile) return null

  const current = steps[step]
  const isLast = step === steps.length - 1

  const node = (
    <AnimatePresence>
      <motion.div
        key="onboard-backdrop"
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        style={{ background: 'rgba(2,7,4,0.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Getting started"
      >
        <motion.div
          key="onboard-card"
          className="card w-full max-w-lg relative overflow-hidden"
          style={{ padding: 0 }}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* accent header band */}
          <div
            className="relative px-6 pt-6 pb-5"
            style={{ background: 'linear-gradient(135deg, rgba(22,163,74,0.16) 0%, rgba(22,163,74,0.04) 100%)', borderBottom: '1px solid var(--border-brand)' }}
          >
            <button
              onClick={() => finish(null)}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)', background: 'var(--input-bg)' }}
              aria-label="Skip tour"
              title="Skip"
            >
              <X size={16} />
            </button>

            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(22,163,74,0.14)', border: '1px solid var(--border-bright)' }}
              >
                <RoleIcon size={24} style={{ color: content.accent }} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: content.accent }}>
                  {role ? t(`roles.${role}`) : t('common.language')}
                </p>
                <h2 className="text-lg font-extrabold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
                  {current === 'welcome'
                    ? t('onboarding.welcome', { name: (profile.full_name || '').split(' ')[0] || '' })
                    : t(`onboarding.stepTitles.${current}`)}
                </h2>
              </div>
            </div>

            {/* progress dots */}
            <div className="flex items-center gap-1.5 mt-4">
              {steps.map((s, i) => (
                <div
                  key={s}
                  className="h-1.5 rounded-full transition-all duration-300"
                  style={{
                    flex: i === step ? '0 0 22px' : '0 0 7px',
                    background: i <= step ? content.accent : 'var(--border-dim)',
                    opacity: i <= step ? 1 : 0.6,
                  }}
                />
              ))}
            </div>
          </div>

          {/* body */}
          <div className="px-6 py-5 min-h-[210px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
              >
                {current === 'welcome' && (
                  <div className="space-y-3">
                    <div className="flex justify-center">
                      <Illustration name="brand/onboarding" size={240} title="Welcome to Tyre Pulse" />
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {content.tagline}
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {t('onboarding.intro')}
                    </p>
                    <div
                      className="flex items-center gap-2 mt-4 px-3 py-2.5 rounded-xl"
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--border-dim)' }}
                    >
                      <Rocket size={16} style={{ color: content.accent }} className="flex-shrink-0" />
                      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {t('onboarding.tailored')}: <span style={{ color: content.accent }} className="font-bold">{t(`roles.${role}`)}</span>
                      </span>
                    </div>
                  </div>
                )}

                {current === 'role' && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      {t('onboarding.whatYouCanDo')}
                    </p>
                    <ul className="space-y-2">
                      {content.capabilities.map((cap, i) => (
                        <motion.li
                          key={i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.05 * i }}
                          className="flex items-start gap-2.5"
                        >
                          <span
                            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ background: 'rgba(22,163,74,0.14)' }}
                          >
                            <Check size={12} style={{ color: content.accent }} strokeWidth={3} />
                          </span>
                          <span className="text-sm leading-snug" style={{ color: 'var(--text-secondary)' }}>{cap}</span>
                        </motion.li>
                      ))}
                    </ul>
                  </div>
                )}

                {current === 'country' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <MapPin size={16} style={{ color: content.accent }} />
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {t('onboarding.chooseScope')}
                      </p>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {t('onboarding.scopeHelp')}
                    </p>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <CountryOption
                        code="All" label={t('common.allCountries')} sub={t('onboarding.globalView')}
                        active={activeCountry === 'All'} accent={content.accent}
                        onClick={() => setActiveCountry('All')}
                      />
                      {COUNTRIES.map(c => (
                        <CountryOption
                          key={c} code={c} label={COUNTRY_LABEL[c] || c}
                          sub={COUNTRY_CURRENCY[c] || ''}
                          active={activeCountry === c} accent={content.accent}
                          onClick={() => setActiveCountry(c)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {current === 'features' && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      {t('onboarding.jumpTo')}
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {content.features.map(({ to, label, icon: Icon, desc }) => (
                        <button
                          key={to}
                          onClick={() => finish(to)}
                          className="text-left p-3 rounded-xl transition-all duration-200 hover:-translate-y-0.5 group"
                          style={{ background: 'var(--input-bg)', border: '1px solid var(--border-dim)' }}
                        >
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center mb-2 transition-colors"
                            style={{ background: 'rgba(22,163,74,0.12)' }}
                          >
                            <Icon size={16} style={{ color: content.accent }} />
                          </div>
                          <p className="text-sm font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{label}</p>
                          <p className="text-[11px] mt-0.5 leading-tight" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {current === 'finish' && (
                  <div className="space-y-3 text-center py-2">
                    <div
                      className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
                      style={{ background: 'rgba(22,163,74,0.14)', border: '1px solid var(--border-bright)' }}
                    >
                      <Check size={30} style={{ color: content.accent }} strokeWidth={2.5} />
                    </div>
                    <h3 className="text-base font-extrabold" style={{ color: 'var(--text-primary)' }}>{t('onboarding.readyTitle')}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {lockedCountry
                        ? <>You're working in <span className="font-bold" style={{ color: content.accent }}>{COUNTRY_LABEL[lockedCountry] || lockedCountry}</span>. </>
                        : <>You're scoped to <span className="font-bold" style={{ color: content.accent }}>{activeCountry === 'All' ? 'All Countries' : (COUNTRY_LABEL[activeCountry] || activeCountry)}</span>. </>}
                      Let's get started.
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* footer nav */}
          <div
            className="px-6 py-4 flex items-center justify-between gap-3"
            style={{ borderTop: '1px solid var(--border-dim)', background: 'var(--glass-bg)' }}
          >
            {step > 0 ? (
              <button onClick={back} className="btn-secondary" style={{ padding: '0.5rem 0.9rem' }}>
                <ArrowLeft size={15} /> {t('onboarding.back')}
              </button>
            ) : (
              <button onClick={() => finish(null)} className="text-sm font-medium transition-colors px-2"
                style={{ color: 'var(--text-muted)' }}>
                {t('onboarding.skip')}
              </button>
            )}

            {isLast ? (
              <button onClick={() => finish(content.primary.to)} className="btn-primary">
                <content.primary.icon size={16} /> {content.primary.label}
              </button>
            ) : (
              <button onClick={next} className="btn-primary">
                {t('onboarding.next')} <ArrowRight size={16} />
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )

  return createPortal(node, document.body)
}

const STEP_TITLES = {
  role: 'Your role',
  country: 'Data scope',
  features: 'Quick start',
  finish: 'Ready to go',
}

function CountryOption({ code, label, sub, active, accent, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 p-2.5 rounded-xl transition-all duration-200 text-left"
      style={{
        background: active ? 'rgba(22,163,74,0.12)' : 'var(--input-bg)',
        border: `1px solid ${active ? accent : 'var(--border-dim)'}`,
      }}
      aria-pressed={active}
    >
      <span
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-extrabold"
        style={{ background: active ? accent : 'var(--input-bg-hover)', color: active ? '#fff' : 'var(--text-secondary)' }}
      >
        {code === 'All' ? <Globe size={15} /> : code.slice(0, 3).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {sub && <span className="block text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
      </span>
    </button>
  )
}
