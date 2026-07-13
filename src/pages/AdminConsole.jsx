/**
 * AdminConsole — centralized administration hub (enterprise plan §7).
 *
 * NON-DESTRUCTIVE consolidation: a single, professional landing hub that groups
 * every existing administration area under one entry and links out to the
 * pages that already own each function. It does NOT move, wrap or re-implement
 * any admin surface — each card is a router link to the real, existing route.
 *
 * - Admin-gated (route guard also applies; this page self-checks for defence in depth).
 * - Hero header + client-side search that filters cards by label/description.
 * - Grouped card grids (Organization, Identity & Access, Workflow & Automation,
 *   Master Data, Data & Integrations, Platform Ops) — responsive 1/2/3 columns.
 * - A few live counts (users, customers) fetched from real services; each is
 *   isolated in its own try/catch so a failure degrades to "—", never an error,
 *   and numbers are never fabricated.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Search, ShieldAlert, ChevronRight, LayoutGrid,
  Building2, Settings, Activity, CreditCard,
  Users, KeyRound, ShieldCheck,
  Workflow, Zap, CheckSquare,
  Database, Palette, Sparkles,
  Upload, Plug, Code2, ScanLine, SearchCheck,
  Server, ScrollText, Compass, LifeBuoy,
  Bot, DollarSign, BookOpen,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/ui/PageHeader'

// ── Section + card catalogue ───────────────────────────────────────────────
// `stat` is an optional key resolved against the live-counts map at render time.
const SECTIONS = [
  {
    key: 'organization',
    title: 'Organization',
    description: 'Tenant, company records, billing and org-level configuration',
    Icon: Building2,
    cards: [
      { label: 'Companies / Customers', to: '/customers', Icon: Building2, stat: 'customers',
        desc: 'Customer & company registry with contacts and status' },
      { label: 'Organization Settings', to: '/settings', Icon: Settings,
        desc: 'Company profile, currency, KPI targets and preferences' },
      { label: 'Tenant Health', to: '/tenant-health', Icon: Activity,
        desc: 'Per-tenant usage, limits and adoption signals' },
      { label: 'Billing & Subscription', to: '/billing', Icon: CreditCard,
        desc: 'Plan, invoices, seats and subscription management' },
    ],
  },
  {
    key: 'identity',
    title: 'Identity & Access',
    description: 'Users, roles, permissions and authentication',
    Icon: KeyRound,
    cards: [
      { label: 'Users', to: '/users', Icon: Users, stat: 'users',
        desc: 'Invite, approve, and manage user accounts' },
      { label: 'Master Access Control', to: '/master-access-control', Icon: KeyRound,
        desc: 'Role-based module permissions and access matrix' },
      { label: 'Security Center', to: '/security-center', Icon: ShieldAlert,
        desc: 'Sessions, MFA policy and security posture' },
      { label: 'SSO Configuration', to: '/sso-configuration', Icon: ShieldCheck,
        desc: 'SAML / OIDC single sign-on providers and domains' },
    ],
  },
  {
    key: 'workflow',
    title: 'Workflow & Automation',
    description: 'Approvals, rules and automated processes',
    Icon: Workflow,
    cards: [
      { label: 'Workflow Settings', to: '/workflow-settings', Icon: Workflow,
        desc: 'Approval chains and process configuration' },
      { label: 'Automation Rules', to: '/automation-rules', Icon: Zap,
        desc: 'Trigger-based automations and alert routing' },
      { label: 'Upload Approvals', to: '/upload-approvals', Icon: CheckSquare,
        desc: 'Review and approve pending data uploads' },
    ],
  },
  {
    key: 'masterdata',
    title: 'Master Data',
    description: 'Reference data, branding and data quality',
    Icon: Database,
    cards: [
      { label: 'Custom Data', to: '/custom-data', Icon: Database,
        desc: 'User-defined fields and reference lists' },
      { label: 'Brand Assets', to: '/brand-assets', Icon: Palette,
        desc: 'Logos, colours and white-label branding' },
      { label: 'Data Cleaning', to: '/cleaning', Icon: Sparkles,
        desc: 'Deduplicate, standardise and repair records' },
    ],
  },
  {
    key: 'integrations',
    title: 'Data & Integrations',
    description: 'Ingestion, connectors and developer tools',
    Icon: Plug,
    cards: [
      { label: 'Data Intake Center', to: '/data-intake', Icon: Upload,
        desc: 'Guided import wizard for spreadsheets and ERP extracts' },
      { label: 'Integrations', to: '/integrations', Icon: Plug,
        desc: 'ERP, telematics and third-party connectors' },
      { label: 'Developer Portal', to: '/developer-portal', Icon: Code2,
        desc: 'API keys, webhooks and integration docs' },
      { label: 'OCR Scanner', to: '/ocr-scanner', Icon: ScanLine,
        desc: 'Extract tyre and document data from images' },
      { label: 'Advanced Search', to: '/advanced-search', Icon: SearchCheck,
        desc: 'Cross-entity search across the whole dataset' },
    ],
  },
  {
    key: 'ai',
    title: 'AI & Automation',
    description: 'AI model configuration, prompts, budgets and usage intelligence',
    Icon: Sparkles,
    cards: [
      { label: 'AI Administration', to: '/ai-administration', Icon: Bot,
        desc: 'Model catalogue, agent prompts, spend budgets and answer feedback' },
      { label: 'AI Cost Monitor', to: '/ai-cost-monitor', Icon: DollarSign,
        desc: 'Token usage, spend tracking and cost analysis across features' },
      { label: 'Knowledge Base', to: '/knowledge-base', Icon: BookOpen,
        desc: 'SOPs, manuals and policies powering retrieval-augmented answers' },
      { label: 'AI Command Center', to: '/ai-command-center', Icon: Sparkles,
        desc: 'Multi-agent copilot for fleet analysis and engineering diagnosis' },
    ],
  },
  {
    key: 'platform',
    title: 'Platform Ops',
    description: 'Health, audit trail and support',
    Icon: Server,
    cards: [
      { label: 'System Health', to: '/system-health', Icon: Server,
        desc: 'Live status of database, storage, edge and auth' },
      { label: 'Audit Trail', to: '/audit', Icon: ScrollText,
        desc: 'Immutable log of user and system actions' },
      { label: 'Onboarding Wizard', to: '/onboarding-wizard', Icon: Compass,
        desc: 'Guided setup for new tenants and teams' },
      { label: 'Help & Support', to: '/help', Icon: LifeBuoy,
        desc: 'Documentation, guides and support contact' },
    ],
  },
]

const ADMIN_ROLES = new Set(['Admin'])

// ── Live counts ─────────────────────────────────────────────────────────────
// Each count is fully isolated: a failure resolves to null (rendered as "—"),
// never an exception that could blank the page. No fabricated fallbacks.
async function fetchCount(build) {
  try {
    const { count, error } = await build()
    if (error || count == null) return null
    return count
  } catch {
    return null
  }
}

async function loadCounts(country) {
  const scoped = (q) =>
    country && country !== 'All' ? q.or(`country.eq.${country},country.is.null`) : q

  const [users, customers] = await Promise.all([
    fetchCount(() =>
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ),
    fetchCount(() =>
      scoped(supabase.from('customers').select('id', { count: 'exact', head: true })),
    ),
  ])

  return { users, customers }
}

// ── Presentation ─────────────────────────────────────────────────────────────
function formatStat(v) {
  if (v == null) return '—'
  return Number(v).toLocaleString()
}

function AdminCard({ card, stat, loading }) {
  const { Icon } = card
  const hasStat = Object.prototype.hasOwnProperty.call(card, 'stat')
  return (
    <Link
      to={card.to}
      className="card group flex items-start gap-3.5 p-4 transition-colors hover:border-[rgba(22,163,74,0.35)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bright/60"
    >
      <div className="w-10 h-10 rounded-xl bg-brand-subtle border border-[rgba(22,163,74,0.2)] flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-brand-bright" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate" title={card.label}>
            {card.label}
          </p>
          {hasStat && (
            <span className="ml-auto shrink-0 tabular-nums text-xs font-semibold text-brand-bright bg-brand-subtle border border-[rgba(22,163,74,0.2)] rounded-full px-2 py-0.5">
              {loading ? (
                <span className="inline-block h-3 w-6 rounded bg-white/10 animate-pulse align-middle" />
              ) : (
                formatStat(stat)
              )}
            </span>
          )}
        </div>
        <p className="text-xs text-muted mt-1 leading-relaxed line-clamp-2">{card.desc}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-[var(--text-dim)] shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  )
}

function Section({ section, counts, loading }) {
  if (section.cards.length === 0) return null
  const { Icon } = section
  return (
    <section aria-label={section.title}>
      <div className="flex items-center gap-2.5 mb-3">
        <Icon className="w-4 h-4 text-brand-bright" />
        <h2 className="text-sm font-bold text-[var(--text-primary)]">{section.title}</h2>
        <span className="text-xs text-muted hidden sm:inline">· {section.description}</span>
        <span className="ml-auto text-[11px] text-[var(--text-dim)] tabular-nums">
          {section.cards.length} {section.cards.length === 1 ? 'area' : 'areas'}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {section.cards.map((card) => (
          <AdminCard
            key={card.to}
            card={card}
            stat={card.stat ? counts[card.stat] : undefined}
            loading={loading && !!card.stat}
          />
        ))}
      </div>
    </section>
  )
}

function AccessDenied() {
  return (
    <div className="card max-w-md mx-auto mt-16 p-8 text-center flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <ShieldAlert size={22} className="text-red-400" />
      </div>
      <h1 className="text-lg font-bold text-[var(--text-primary)]">Admin access required</h1>
      <p className="text-sm text-muted">
        The Admin Console is restricted to administrators. If you believe you need
        access, ask an administrator to update your role.
      </p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AdminConsole() {
  const { profile, loading: authLoading } = useAuth()
  const { activeCountry } = useSettings()
  const isAdmin = ADMIN_ROLES.has(profile?.role)

  const [query, setQuery] = useState('')
  const [counts, setCounts] = useState({ users: null, customers: null })
  const [countsLoading, setCountsLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    if (!isAdmin) return undefined
    setCountsLoading(true)
    loadCounts(activeCountry)
      .then((next) => { if (mountedRef.current) setCounts(next) })
      .finally(() => { if (mountedRef.current) setCountsLoading(false) })
    return () => { mountedRef.current = false }
  }, [isAdmin, activeCountry])

  const totalAreas = useMemo(
    () => SECTIONS.reduce((n, s) => n + s.cards.length, 0),
    [],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS
      .map((s) => ({
        ...s,
        cards: s.cards.filter(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            c.desc.toLowerCase().includes(q) ||
            s.title.toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.cards.length > 0)
  }, [query])

  const matchCount = useMemo(
    () => filtered.reduce((n, s) => n + s.cards.length, 0),
    [filtered],
  )

  if (authLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="h-12 w-64 rounded-xl bg-white/5 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-[86px] rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!isAdmin) return <AccessDenied />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Console"
        subtitle={`One place for every administration area — ${totalAreas} tools across ${SECTIONS.length} groups`}
        icon={LayoutGrid}
        badge="Admin"
      />

      {/* Search */}
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)] pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search admin tools (users, billing, integrations…)"
          aria-label="Search admin tools"
          className="input pl-9"
        />
        {query.trim() && (
          <p className="text-xs text-muted mt-1.5">
            {matchCount} {matchCount === 1 ? 'result' : 'results'} for “{query.trim()}”
          </p>
        )}
      </div>

      {/* Sections */}
      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <Search className="w-8 h-8 text-[var(--text-dim)] mx-auto mb-3" />
          <p className="text-sm text-[var(--text-secondary)]">No admin tools match “{query.trim()}”.</p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="btn-secondary text-xs mt-4"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {filtered.map((section) => (
            <Section
              key={section.key}
              section={section}
              counts={counts}
              loading={countsLoading}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted">
        Every tool above opens its dedicated, existing module. Live counts reflect
        the active country scope and degrade to “—” if a metric is temporarily
        unavailable.
      </p>
    </div>
  )
}
