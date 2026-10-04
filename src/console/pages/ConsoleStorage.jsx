/**
 * ConsoleStorage.jsx - Storage at /console/storage (super admin).
 *
 * Every file Tyre Pulse keeps: how big, how fast it grows, who can reach it
 * and how long it is kept. No console page showed storage before; the
 * public-bucket check stays in Security Audit.
 *
 * Nothing on this page deletes a file. Retention rules are recorded only
 * (company exports keep their existing nightly cleanup), duplicates are listed
 * for review, and the orphan scan only reads. Every figure comes from the
 * super-admin RPCs in migration 20260930191000.
 */
import { useMemo, useRef, useState } from 'react'
import { HardDrive, RefreshCw, SearchCheck, Plus, ArrowRightLeft } from 'lucide-react'
import { Btn, ConfirmImpactDialog, ErrorState, Note } from '../components/ui'
import { StatusStrip, MovedFrom, useLoad } from './runtime/runtimeParts'
import {
  SpacePanel, GrowthPanel, RecommendationsPanel, BucketsPanel, RetentionRulesPanel, LargestFilesPanel, CompaniesPanel,
  DuplicatesPanel, OrphansPanel, AccessPanel, StorageLoading, StorageError,
} from './storage/StoragePanels'
import { BucketDrawer, RetentionDialog, DuplicatesDrawer } from './storage/StorageDialogs'
import { getStorageSummary, runOrphanScan } from '../../lib/api/storageCenter'
import { fmtBytes, fmtInt, growthSeries, buildRecommendations } from '../../lib/storageCenter'
import { fmtRiyadh } from '../../lib/databaseCenter'
import { toUserMessage } from '../../lib/safeError'

export default function ConsoleStorage() {
  const summary = useLoad(getStorageSummary)
  const s = summary.data
  const buckets = useMemo(() => (Array.isArray(s?.buckets) ? s.buckets : []), [s])
  const rules = useMemo(() => (Array.isArray(s?.retention_rules) ? s.retention_rules : []), [s])
  const tenantDays = s?.tenant_export_days ?? null
  const total = buckets.reduce((a, b) => a + (Number(b.bytes) || 0), 0)
  const files = buckets.reduce((a, b) => a + (Number(b.files) || 0), 0)
  const series = useMemo(() => growthSeries(s?.growth || []), [s])
  const recs = useMemo(() => buildRecommendations({ buckets, rules, tenantExportDays: tenantDays, growth: series }), [buckets, rules, tenantDays, series])
  const largestPhoto = (buckets.find((b) => b.id === 'tyre-photos') || {}).largest_bytes

  const [drawer, setDrawer] = useState(null)
  const [ruleFor, setRuleFor] = useState(undefined) // undefined = closed, null = new, string = bucket
  const [dupOpen, setDupOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const anchors = { growth: useRef(null), buckets: useRef(null), retention: useRef(null), duplicates: useRef(null) }

  async function scan() {
    setScanBusy(true); setErr('')
    try {
      const r = await runOrphanScan()
      setNotice(`Orphan scan checked ${fmtInt(r?.scanned_files)} files. Nothing was deleted.`)
      setScanOpen(false); summary.reload()
    } catch (e) { setErr(toUserMessage(e, 'The orphan scan could not run.')) } finally { setScanBusy(false) }
  }
  function act(target) {
    if (target === 'duplicates') { setDupOpen(true); return }
    if (target === 'retention') { setRuleFor('import-files'); return }
    anchors[target]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const empty = buckets.filter((b) => !Number(b.files)).length
  const today = buckets.reduce((a, b) => a + (Number(b.files_today) || 0), 0)
  const month = buckets.reduce((a, b) => a + (Number(b.files_month) || 0), 0)
  const pub = buckets.filter((b) => b.public).length
  const dash = summary.error ? 'N/A' : '...'
  const strip = [
    { label: 'Total stored', value: s ? fmtBytes(total) : dash },
    { label: 'Files', value: s ? fmtInt(files) : dash },
    { label: 'Buckets', value: s ? fmtInt(buckets.length) : dash, extra: s && empty ? `${empty} empty` : null },
    { label: 'Added this month', value: s ? `${fmtInt(month)} files` : dash },
    { label: 'Added today', value: s ? `${fmtInt(today)} files` : dash },
    { label: 'Public buckets', value: s ? `${pub} of ${buckets.length}` : dash, tone: s ? (pub ? 'danger' : 'good') : undefined },
    { label: 'Plan limit', value: 'N/A, billing off', tone: 'muted' },
    { label: 'Data as of', value: s?.generated_at ? `${fmtRiyadh(s.generated_at, { date: false, time: true })} Riyadh` : dash },
  ]

  return (
    <div className="space-y-4 max-w-[1400px]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2"><HardDrive size={18} className="text-orange-400 shrink-0" aria-hidden="true" /> Storage</h1>
          <p className="text-xs text-gray-400 mt-1 max-w-3xl">
            Every file Tyre Pulse keeps: photos, uploads and exports. How big, how fast it grows, who can reach it, and how long it is kept.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn icon={RefreshCw} onClick={summary.reload} busy={summary.loading}>Refresh</Btn>
          <Btn icon={SearchCheck} onClick={() => setScanOpen(true)} disabled={!s}>Run orphan scan</Btn>
          <Btn variant="primary" icon={Plus} onClick={() => setRuleFor(null)} disabled={!s}>Add retention rule</Btn>
        </div>
      </header>
      <MovedFrom icon={ArrowRightLeft} items={[{ label: 'Security Audit', to: '/console/security-audit' }]}
        note="New page. No console page showed storage before. The public-bucket check stays in Security." />
      <StatusStrip cells={strip} label="Storage status" />
      {notice && <Note tone="accent">{notice}</Note>}
      {err && <ErrorState message={err} />}

      {summary.loading && !s ? <StorageLoading />
        : summary.error && !s ? <StorageError message={summary.error} onRetry={summary.reload} />
          : !s ? <StorageError message="The storage summary came back empty, so no figure can be shown. Try again." onRetry={summary.reload} />
            : (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <SpacePanel buckets={buckets} folders={s.folders} total={total} />
                <div ref={anchors.growth} className="min-w-0"><GrowthPanel series={series} buckets={buckets} largestPhoto={largestPhoto} /></div>
              </div>
              <RecommendationsPanel items={recs} onAct={act} generatedAt={s.generated_at} />
              <div ref={anchors.buckets}>
                <BucketsPanel buckets={buckets} rules={rules} tenantExportDays={tenantDays}
                  onOpen={setDrawer} onRule={(b) => setRuleFor(b)} onScan={() => setScanOpen(true)} />
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div ref={anchors.retention} className="min-w-0">
                  <RetentionRulesPanel buckets={buckets} rules={rules} tenantExportDays={tenantDays} onEdit={(b) => setRuleFor(b)} />
                </div>
                <LargestFilesPanel largest={s.largest} onError={setErr} />
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <CompaniesPanel companies={s.companies} totalBytes={total} />
                <div ref={anchors.duplicates} className="min-w-0"><DuplicatesPanel buckets={buckets} onReview={() => setDupOpen(true)} /></div>
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <OrphansPanel scan={s.last_orphan_scan} buckets={buckets} onScan={() => setScanOpen(true)} busy={scanBusy} />
                <AccessPanel buckets={buckets} />
              </div>
            </>
          )}

      <BucketDrawer bucket={drawer} folders={s?.folders || []} rules={rules} tenantExportDays={tenantDays}
        onClose={() => setDrawer(null)} onChanged={summary.reload} onAddRule={(b) => { setDrawer(null); setRuleFor(b) }} />
      <RetentionDialog open={ruleFor !== undefined} initialBucket={ruleFor || null} buckets={buckets} rules={rules} tenantExportDays={tenantDays}
        onClose={() => setRuleFor(undefined)} onSaved={summary.reload} />
      <DuplicatesDrawer open={dupOpen} onClose={() => setDupOpen(false)} />
      <ConfirmImpactDialog open={scanOpen} title="Run an orphan scan" confirmLabel="Run scan" busy={scanBusy}
        onCancel={() => setScanOpen(false)} onConfirm={scan}
        impact={{
          what: s?.last_orphan_scan ? `Checks every file again. Last scan ${fmtRiyadh(s.last_orphan_scan.ran_at, { time: true })}.` : 'No orphan scan has ever run, so unused files are unknown.',
          change: 'The scan only lists files with no matching record. It deletes nothing. The result is kept and audited.',
          who: 'Nobody. Results are shown to super admins.',
          undo: 'Nothing to undo: it only reads.',
        }} />
    </div>
  )
}
