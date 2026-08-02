import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, ListTree, CopyX, Brain,
  DollarSign, TrendingUp, Boxes, Archive, Table2, Activity,
  UploadCloud, History, Wand2, Layers,
  Database, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { getControlCenterSummary, openIssueCount } from '../../lib/api/controlCenter'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, StatTile, Btn, Badge, Note,
  LoadingState, EmptyState, ErrorState,
} from '../components/ui'

/**
 * Data Operations hub.
 *
 * One launchpad for every data-management surface a super-admin reaches from
 * scattered places today: trust and quality, cost and production, imports and
 * masters. Each card links to an EXISTING route (verified against App.jsx) - it
 * adds no new capability, it only makes the set findable in one screen.
 *
 * The headline strip is a best-effort read of the diagnostics summary; if it
 * cannot load, the link cards still render (they are the point of the page).
 */

const GROUPS = [
  {
    key: 'trust',
    title: 'Trust & quality',
    subtitle: 'Find and fix data-quality problems before they reach a report.',
    icon: ShieldCheck,
    cards: [
      { icon: ShieldCheck, title: 'Data Trust & Control', route: '/console/control-center',
        desc: 'Trust scores, figure lineage and one-call diagnostics for every KPI.' },
      { icon: ListTree, title: 'Data Reconciliation', route: '/data-reconciliation',
        desc: 'Orphan assets, duplicate tyres and serial conflicts, with safe fixes.' },
      { icon: CopyX, title: 'Duplicate Control', route: '/console/duplicates',
        desc: 'Detect and remove re-inserted rows, with a full undo archive.' },
      { icon: Brain, title: 'Teach the Classifier', route: '/console/classification-learning',
        desc: 'Review corrections so the expense classifier learns from your edits.' },
    ],
  },
  {
    key: 'cost',
    title: 'Cost & production',
    subtitle: 'Operating cost per unit and the production data behind it.',
    icon: DollarSign,
    cards: [
      { icon: DollarSign, title: 'Cost per M3', route: '/cost-per-m3',
        desc: 'Internal plus SCO plus SANY cost over approved production, by region.' },
      { icon: TrendingUp, title: 'CPK Intelligence', route: '/cpk-intelligence',
        desc: 'Cost per km and per engine-hour, split movable versus non-movable.' },
      { icon: Boxes, title: 'Production M3', route: '/production-m3',
        desc: 'Approved and rejected concrete production by site and period.' },
      { icon: Archive, title: 'SCO Costs', route: '/sco-costs',
        desc: 'Sub-contracted operating cost ledger feeding the cost per M3.' },
      { icon: Table2, title: 'SANY Invoices', route: '/sany-invoices',
        desc: 'SANY summary and parts-detail invoices, linked by quotation number.' },
      { icon: Activity, title: 'Expenses & CPK', route: '/expense-report',
        desc: 'Real expense grid with cost per km trends and what moved.' },
    ],
  },
  {
    key: 'imports',
    title: 'Imports & masters',
    subtitle: 'Load data and keep the reference masters clean.',
    icon: UploadCloud,
    cards: [
      { icon: UploadCloud, title: 'Data Intake', route: '/data-intake',
        desc: 'Upload ERP, production, SCO and SANY files through the intake wizard.' },
      { icon: History, title: 'Import History', route: '/console/import-history',
        desc: 'Every upload, its rows, duplicates and errors, plus repeat-file flags.' },
      { icon: Wand2, title: 'Smart Import', route: '/console/smart-import',
        desc: 'Drop any Excel or CSV and it auto-detects the module and maps columns.' },
      { icon: Layers, title: 'Material Master', route: '/console/material-master',
        desc: 'Review and confirm item categories that drive expense classification.' },
    ],
  },
]

export default function ConsoleDataOps() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const data = await getControlCenterSummary()
      if (!data || data.ok === false) {
        setSummary(null)
        setError('The diagnostics summary is not available right now.')
      } else {
        setSummary(data)
      }
    } catch (e) {
      setSummary(null)
      setError(toUserMessage(e, 'Could not load the diagnostics summary.'))
    } finally {
      setLoading(false)
    }
  }

  const openIssues = summary ? openIssueCount(summary.issues) : 0
  const vol = summary?.volumes || {}

  return (
    <div className="space-y-6 max-w-7xl">
      {/* ── header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Data Operations</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            One launchpad for every data-management surface.
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={load} busy={loading} title="Refresh">Refresh</Btn>
      </div>

      {/* ── headline strip ── */}
      <Panel>
        <PanelHeader
          icon={Database}
          title="Data at a glance"
          subtitle="Open data-quality issues and total record volumes across all data."
          actions={summary ? (
            <Badge tone={openIssues > 0 ? 'warning' : 'good'} icon={AlertTriangle}>
              {fmtInt(openIssues)} open {openIssues === 1 ? 'issue' : 'issues'}
            </Badge>
          ) : null}
        />
        {loading ? (
          <LoadingState label="Loading diagnostics" rows={2} />
        ) : error ? (
          <>
            <ErrorState message={error} onRetry={load} />
            <Note icon={AlertTriangle} tone="default">
              The launchpad below still works. Only the headline figures could not be read.
            </Note>
          </>
        ) : !summary ? (
          <EmptyState
            title="No diagnostics yet"
            reason="No summary was returned for the current data set."
          />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatTile
              label="Open issues"
              value={fmtInt(openIssues)}
              tone={openIssues > 0 ? 'warning' : 'good'}
              icon={AlertTriangle}
              onClick={() => navigate('/console/control-center')}
              sub="tap to review"
            />
            <StatTile label="Expense rows" value={fmtInt(vol.expense_rows)} icon={Database} />
            <StatTile label="Tyre rows" value={fmtInt(vol.tyre_rows)} icon={Database} />
            <StatTile label="Fleet rows" value={fmtInt(vol.fleet_rows)} icon={Database} />
            <StatTile label="Work orders" value={fmtInt(vol.work_orders)} icon={Database} />
          </div>
        )}
      </Panel>

      {/* ── launchpad groups ── */}
      {GROUPS.map((g) => (
        <Panel key={g.key}>
          <PanelHeader icon={g.icon} title={g.title} subtitle={g.subtitle} />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {g.cards.map((c) => (
              <LinkCard key={c.route} card={c} onOpen={() => navigate(c.route)} />
            ))}
          </div>
        </Panel>
      ))}
    </div>
  )
}

function LinkCard({ card, onOpen }) {
  const { icon: Icon, title, desc, route } = card
  return (
    <button
      onClick={onOpen}
      className="text-left bg-gray-900/50 border border-gray-800 rounded-xl p-4 transition-colors hover:border-orange-700/50 hover:bg-gray-900 flex flex-col gap-2"
    >
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-800/40 flex items-center justify-center shrink-0">
          <Icon size={16} className="text-orange-400" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-200 truncate">{title}</p>
          <p className="text-[11px] font-mono text-gray-600 truncate">{route}</p>
        </div>
      </div>
      <p className="text-xs text-gray-500 flex-1">{desc}</p>
      <span className="text-xs text-orange-400 font-medium mt-1">Open</span>
    </button>
  )
}

function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  return Math.round(Number(v)).toLocaleString('en-US')
}
