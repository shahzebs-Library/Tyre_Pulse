/**
 * ConsoleDatabase.jsx - the Database Center at /console/database.
 *
 * One place for database health, backups and restore, data quality,
 * reconciliation, trust scores, lineage and the read-only data browser.
 * Replaces seven console pages and keeps every one of them whole:
 *   Backups             -> /console/database/backups   (the full backups tool)
 *   Data Browser        -> /console/database/browser
 *   Data Trust & Control, Data Quality, Reconciliation, Correction Center,
 *   Lineage Explorer    -> /console/database/trust/<view>
 * The old routes redirect there. Sections live in the PATH, not in ?tab=,
 * because every embedded page already uses ?tab= for its own tabs.
 *
 * Every figure comes from a super-admin RPC (migration 20260930190000) or an
 * existing service. A failed source says so; nothing reads as a fake zero.
 */
import { Suspense, lazy, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Database, Activity, Table2, DatabaseBackup, ShieldCheck, Search, History, RefreshCw, Play, ArrowRightLeft,
  Scale, ClipboardList, GitBranch, Gauge,
} from 'lucide-react'
import { Btn, LoadingState, Segmented } from '../components/ui'
import { StatusStrip, MovedFrom, SectionTabs, useLoad } from './runtime/runtimeParts'
import TablesPanel from './database/TablesPanel'
import BackupsPanel from './database/BackupsPanel'
import {
  ConnectionsPanel, QueryTimePanel, FreshnessPanel, QualityPanel, TrustPanel, ReconPanel, MigrationsPanel, BrowserTeaser, LineageLinks,
} from './database/HealthPanels'
import {
  getDatabaseOverview, getQueryTimeTop, getTableFreshness, listRestoreTests, countArchivedDuplicates,
} from '../../lib/api/databaseCenter'
import { listBackupSnapshots } from '../../lib/api/backups'
import { listQualityResults, listQualityRules, listReconciliationRuns, listCorrectionCases } from '../../lib/api/dataTrustOps'
import { listTrustAlerts, listDataAssets } from '../../lib/api/lineageOps'
import { getDataTrustOverview } from '../../lib/api/dataTrust'
import { buildTrustReport } from '../../lib/dataTrust'
import { loadSystemConfig, configBool } from '../../lib/api/systemConfig'
import { fmtBytes, fmtInt, fmtPct, fmtRiyadh, shapeTables, recoveryWindow, connectionSummary } from '../../lib/databaseCenter'

const ConsoleBackups = lazy(() => import('./ConsoleBackups'))
const ConsoleDataBrowser = lazy(() => import('./ConsoleDataBrowser'))
const ConsoleControlCenter = lazy(() => import('./ConsoleControlCenter'))
const ConsoleDataQuality = lazy(() => import('./ConsoleDataQuality'))
const ConsoleReconciliation = lazy(() => import('./ConsoleReconciliation'))
const ConsoleCorrectionCenter = lazy(() => import('./ConsoleCorrectionCenter'))
const ConsoleLineageExplorer = lazy(() => import('./ConsoleLineageExplorer'))

export const DATABASE_TABS = [
  { key: 'health', label: 'Health', icon: Activity },
  { key: 'tables', label: 'Tables', icon: Table2 },
  { key: 'backups', label: 'Backups', icon: DatabaseBackup },
  { key: 'trust', label: 'Data trust', icon: ShieldCheck },
  { key: 'browser', label: 'Data browser', icon: Search },
  { key: 'migrations', label: 'Migrations', icon: History },
]

export const TRUST_VIEWS = [
  { key: 'control', label: 'Trust and control', icon: ShieldCheck },
  { key: 'quality', label: 'Data quality', icon: Gauge },
  { key: 'recon', label: 'Reconciliation', icon: Scale },
  { key: 'cases', label: 'Correction cases', icon: ClipboardList },
  { key: 'lineage', label: 'Lineage', icon: GitBranch },
]

const MOVED = [
  { label: 'Data Browser', to: '/console/database/browser' },
  { label: 'Backups', to: '/console/database/backups' },
  { label: 'Data Trust & Control', to: '/console/database/trust/control' },
  { label: 'Data Quality', to: '/console/database/trust/quality' },
  { label: 'Reconciliation', to: '/console/database/trust/recon' },
  { label: 'Correction Center', to: '/console/database/trust/cases' },
  { label: 'Lineage Explorer', to: '/console/database/trust/lineage' },
]

const SECTION_KEYS = new Set(DATABASE_TABS.map((t) => t.key))
const VIEW_KEYS = new Set(TRUST_VIEWS.map((t) => t.key))

async function loadTrust() {
  return buildTrustReport(await getDataTrustOverview({}))
}
async function loadBackupSwitch() {
  await loadSystemConfig()
  return configBool('backup_enabled', true)
}

function Fallback() { return <LoadingState label="Loading section" rows={5} /> }

export default function ConsoleDatabase() {
  const navigate = useNavigate()
  const params = useParams()
  const section = SECTION_KEYS.has(params.section) ? params.section : 'health'
  const view = VIEW_KEYS.has(params.view) ? params.view : 'control'
  const go = useCallback((s, v) => navigate(`/console/database${s && s !== 'health' ? `/${s}` : ''}${v ? `/${v}` : ''}`), [navigate])
  const openTrust = useCallback((v) => go(v === 'browser' ? 'browser' : 'trust', v === 'browser' ? undefined : v), [go])

  const overview = useLoad(getDatabaseOverview)
  const snaps = useLoad(() => listBackupSnapshots(40))
  const tests = useLoad(() => listRestoreTests(10))
  const backupSwitch = useLoad(loadBackupSwitch)
  const health = section === 'health'
  const query = useLoad(() => getQueryTimeTop(12), { auto: health })
  const fresh = useLoad(getTableFreshness, { auto: health })
  const quality = useLoad(() => listQualityResults({}), { auto: health })
  const rules = useLoad(listQualityRules, { auto: health })
  const recon = useLoad(() => listReconciliationRuns({}), { auto: health })
  const cases = useLoad(() => listCorrectionCases({}), { auto: health })
  const alerts = useLoad(() => listTrustAlerts({}), { auto: health })
  const assets = useLoad(() => listDataAssets({}), { auto: health })
  const dupCount = useLoad(countArchivedDuplicates, { auto: health })
  const trust = useLoad(loadTrust, { auto: health })

  const tables = useMemo(() => (overview.data ? shapeTables(overview.data.tables, overview.data.db_bytes) : null), [overview.data])
  const win = recoveryWindow(snaps.data || [])
  const lastTest = (tests.data || [])[0]
  const conn = connectionSummary(overview.data?.connections)
  const o = overview.data

  function refreshAll() {
    overview.reload(); snaps.reload(); tests.reload(); backupSwitch.reload()
    if (health) { query.reload(); fresh.reload(); quality.reload(); rules.reload(); recon.reload(); cases.reload(); alerts.reload(); assets.reload(); dupCount.reload(); trust.reload() }
  }

  const strip = [
    { label: 'Database size', value: o ? fmtBytes(o.db_bytes, { digits: 0 }) : overview.error ? 'N/A' : '...' },
    { label: 'Connections', value: conn ? `${conn.total} of ${conn.max ?? 'N/A'}` : overview.error ? 'N/A' : '...', extra: conn ? `${conn.busy} busy` : null },
    { label: 'Cache hits', value: o ? fmtPct(o.cache_hit_pct, 2) : overview.error ? 'N/A' : '...' },
    { label: 'Migrations applied', value: o?.migrations ? fmtInt(o.migrations.total) : o ? 'N/A' : '...' },
    { label: 'Latest migration', value: o?.migrations?.latest?.[0]?.version || (o ? 'N/A' : '...') },
    { label: 'Recovery points', value: snaps.data ? `${win.count} kept` : snaps.error ? 'N/A' : '...', tone: snaps.data ? (win.count ? 'good' : 'warning') : undefined },
    { label: 'Restore last tested', value: tests.error ? 'N/A' : !tests.data ? '...' : lastTest ? fmtRiyadh(lastTest.started_at) : 'Not recorded',
      tone: tests.data && !lastTest ? 'danger' : lastTest?.status === 'failed' ? 'danger' : undefined },
    { label: 'Data as of', value: o?.generated_at ? `${fmtRiyadh(o.generated_at, { date: false, time: true })} Riyadh` : '...' },
  ]

  function renderSection() {
    switch (section) {
      case 'health':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2 min-w-0">
                <TablesPanel tables={tables} tableCount={o?.table_count} allBytes={o?.all_table_bytes} dbBytes={o?.db_bytes}
                  loading={overview.loading} error={overview.error} onRetry={overview.reload} onBrowse={() => go('browser')} />
              </div>
              <div className="space-y-4 min-w-0">
                <ConnectionsPanel overview={overview} />
                <BackupsPanel snaps={snaps} tests={tests} backupEnabled={backupSwitch.data} cronJob={o?.nightly_backup_job}
                  onChanged={() => { snaps.reload(); tests.reload(); backupSwitch.reload() }} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2 min-w-0"><QueryTimePanel query={query} onChanged={query.reload} /></div>
              <div className="min-w-0"><FreshnessPanel fresh={fresh} /></div>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2 space-y-4 min-w-0">
                <QualityPanel quality={quality} rules={rules} onChanged={quality.reload} onOpen={openTrust} />
                <MigrationsPanel overview={overview} />
              </div>
              <div className="space-y-4 min-w-0">
                <TrustPanel trust={trust} onOpen={openTrust} />
                <ReconPanel recon={recon} dupCount={dupCount} cases={cases} alerts={alerts} onChanged={recon.reload} onOpen={openTrust} />
              </div>
            </div>
            <BrowserTeaser onOpen={openTrust} />
            <LineageLinks assets={assets} cases={cases} onOpen={openTrust} />
          </div>
        )
      case 'tables':
        return <TablesPanel full tables={tables} tableCount={o?.table_count} allBytes={o?.all_table_bytes} dbBytes={o?.db_bytes}
          loading={overview.loading} error={overview.error} onRetry={overview.reload} onBrowse={() => go('browser')} />
      case 'backups':
        return <Suspense fallback={<Fallback />}><ConsoleBackups /></Suspense>
      case 'browser':
        return <Suspense fallback={<Fallback />}><ConsoleDataBrowser /></Suspense>
      case 'migrations':
        return <MigrationsPanel overview={overview} full />
      case 'trust':
        return (
          <div className="space-y-3">
            <Segmented role="tablist" ariaLabel="Data trust views" value={view} onChange={(v) => go('trust', v)}
              options={TRUST_VIEWS.map((t) => ({ key: t.key, label: t.label }))} />
            <Suspense fallback={<Fallback />}>
              {view === 'control' && <ConsoleControlCenter />}
              {view === 'quality' && <ConsoleDataQuality />}
              {view === 'recon' && <ConsoleReconciliation />}
              {view === 'cases' && <ConsoleCorrectionCenter />}
              {view === 'lineage' && <ConsoleLineageExplorer />}
            </Suspense>
          </div>
        )
      default: return null
    }
  }

  return (
    <div className="space-y-4 max-w-[1400px]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2"><Database size={18} className="text-orange-400 shrink-0" aria-hidden="true" /> Database Center</h1>
          <p className="text-xs text-gray-400 mt-1 max-w-3xl">
            The health of the Tyre Pulse database, its backups, and how much each number can be trusted. Everything here is safe to open; changes ask first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn icon={RefreshCw} onClick={refreshAll} busy={overview.loading}>Refresh</Btn>
          <Btn icon={Play} onClick={() => go('trust', 'quality')}>Run data checks</Btn>
          <Btn variant="primary" icon={DatabaseBackup} onClick={() => go('backups')}>Back up now</Btn>
        </div>
      </header>
      <MovedFrom icon={ArrowRightLeft} items={MOVED} />
      <StatusStrip cells={strip} label="Database status" />
      <SectionTabs label="Database Center sections" value={section} onChange={(k) => go(k)}
        tabs={DATABASE_TABS.map((t) => ({ ...t, count: t.key === 'migrations' && o?.migrations ? o.migrations.today || null : undefined }))} />
      <div role="tabpanel" aria-label={DATABASE_TABS.find((t) => t.key === section)?.label}>
        {renderSection()}
      </div>
    </div>
  )
}
