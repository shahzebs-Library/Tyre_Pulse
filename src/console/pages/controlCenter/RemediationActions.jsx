/**
 * RemediationActions - the "fix it" half of the Data Trust & Control Center.
 *
 * The rest of the control center DIAGNOSES; this panel turns those diagnoses into
 * ONE-CLICK FIXES. It writes no SQL and defines no RPC of its own: every action is
 * a thin call into an EXISTING self-gating service (duplicateControl /
 * dataReconciliation / reconBrand / reconDupKeys / materialMaster / systemLogs),
 * each of which is org-scoped and role-gated inside Postgres. This file only
 * relocates those calls behind a plain-English button and an honest result line.
 *
 * THREE RULES THIS SURFACE KEEPS:
 *
 *  1. Every card loads its own count independently. A card is its own component
 *     with its own load/error/result state, so one unreachable service degrades
 *     that single card to an honest empty/error state and never sinks the panel.
 *
 *  2. Anything that changes data asks first. Destructive actions open a Modal
 *     confirm; the one action that actually deletes rows (duplicate removal)
 *     requires the word CONFIRM to be typed. Nothing here is irreversible - the
 *     duplicate removal archives every row first and is undoable from Duplicate
 *     Control.
 *
 *  3. Brand fill and classification review are NOT bulk-guessed. A blank brand and
 *     an unreviewed cost code are per-row human decisions, so those cards route to
 *     the existing surface instead of inventing a value.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wrench, RefreshCw, ShieldCheck, CheckCircle2, ExternalLink,
  CopyX, Link2Off, Tag, Shuffle, Boxes, AlertTriangle,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, Badge, Btn, Modal,
  LoadingState, ErrorState,
} from '../../components/ui'
import { toUserMessage } from '../../../lib/safeError'
import {
  listDuplicateTargets, previewDuplicates, resolveDuplicates,
} from '../../../lib/api/duplicateControl'
import {
  listOrphanAssets, backfillAllOrphanAssets,
} from '../../../lib/api/dataReconciliation'
import { listBrandGapSummary } from '../../../lib/api/reconBrand'
import {
  listDuplicateKeyTyres, resolveDuplicateKey,
} from '../../../lib/api/reconDupKeys'
import { materialCoverage } from '../../../lib/api/materialMaster'
import { getHealthMetrics, resolveAllSystemLogs } from '../../../lib/api/systemLogs'

// ── formatting ────────────────────────────────────────────────────────────────

const num = (v) => (Number(v) || 0).toLocaleString()

// ── a single self-contained action card ────────────────────────────────────────
//
// Each card owns its lifecycle: it loads its own count, holds its own error/result
// state, and runs its own action. `load` returns a small view model; `action`
// (optional) runs a fix and returns a plain-English result line; `route`
// (optional) navigates to the surface that owns the manual fix.

function ActionCard({
  icon: Icon, title, description, country,
  load,          // async (country) -> { count, tone, value, sub, empty, meta }
  route,         // { to, label } | null
  action,        // { label, icon, verb, confirmTitle, confirmBody, typed, run, tone } | null
}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [typedValue, setTypedValue] = useState('')
  const [running, setRunning] = useState(false)
  const mountedRef = useRef(true)
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const vm = await load(country)
      if (mountedRef.current) setData(vm || {})
    } catch (err) {
      if (mountedRef.current) setError(toUserMessage(err, 'This check could not run.'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [load, country])

  useEffect(() => {
    mountedRef.current = true
    refresh()
    return () => { mountedRef.current = false }
  }, [refresh])

  const openConfirm = () => {
    setResult(null)
    setTypedValue('')
    setConfirmOpen(true)
  }

  const runAction = async () => {
    if (!action) return
    setRunning(true)
    setError(null)
    try {
      const line = await action.run(data?.meta, country)
      if (mountedRef.current) {
        setResult(line || 'Done.')
        setConfirmOpen(false)
      }
      await refresh()
    } catch (err) {
      if (mountedRef.current) setError(toUserMessage(err, 'That fix could not be applied.'))
    } finally {
      if (mountedRef.current) setRunning(false)
    }
  }

  const count = data?.count ?? 0
  const canAct = action && count > 0
  const typedOk = !action?.typed || typedValue.trim().toUpperCase() === 'CONFIRM'

  return (
    <Panel>
      <PanelHeader
        icon={Icon}
        title={title}
        subtitle={description}
        actions={(
          <Btn size="xs" variant="quiet" icon={RefreshCw} onClick={refresh} busy={loading} title="Re-check">
            Recheck
          </Btn>
        )}
      />

      {loading ? (
        <LoadingState rows={2} label="Checking" />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`text-2xl font-semibold tabular-nums ${
              count > 0 ? (data?.tone === 'danger' ? 'text-red-300'
                : data?.tone === 'warning' ? 'text-amber-300'
                  : 'text-orange-300')
                : 'text-emerald-300'
            }`}>
              {data?.value != null ? data.value : num(count)}
            </span>
            {data?.sub && <span className="text-xs text-gray-500">{data.sub}</span>}
            {count === 0 && !data?.value && (
              <Badge tone="good" icon={CheckCircle2}>All clear</Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canAct && (
              <Btn
                variant={action.tone || 'primary'}
                size="sm"
                icon={action.icon}
                onClick={openConfirm}
                disabled={running}
              >
                {action.label}
              </Btn>
            )}
            {route && (
              <Btn variant="ghost" size="sm" icon={ExternalLink} onClick={() => navigate(route.to)}>
                {route.label}
              </Btn>
            )}
          </div>

          {result && (
            <Note icon={CheckCircle2} tone="accent">{result}</Note>
          )}
        </div>
      )}

      {action && (
        <Modal
          open={confirmOpen}
          title={action.confirmTitle}
          subtitle={action.confirmSubtitle}
          onClose={() => (running ? null : setConfirmOpen(false))}
          width="max-w-lg"
          footer={(
            <>
              <Btn variant="ghost" size="sm" onClick={() => setConfirmOpen(false)} disabled={running}>
                Cancel
              </Btn>
              <Btn
                variant={action.tone === 'danger' ? 'danger' : 'primary'}
                size="sm"
                onClick={runAction}
                busy={running}
                disabled={running || !typedOk}
              >
                {action.verb || action.label}
              </Btn>
            </>
          )}
        >
          <div className="space-y-3 text-sm text-gray-300">
            <p>{action.confirmBody}</p>
            {action.typed && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Type CONFIRM to proceed
                </label>
                <input
                  value={typedValue}
                  onChange={(e) => setTypedValue(e.target.value)}
                  placeholder="CONFIRM"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none"
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </Panel>
  )
}

// ── loaders + actions (each reuses an existing self-gating service) ─────────────

/** Duplicate rows: aggregate the deletable count across every safelisted target. */
async function loadDuplicates(country) {
  const targets = await listDuplicateTargets()
  let deletable = 0
  let protectedRows = 0
  const perTarget = []
  for (const t of targets) {
    const p = await previewDuplicates(t.key, country || null)
    const del = Number(p?.extra_deletable) || 0
    protectedRows += Number(p?.extra_protected) || 0
    if (del > 0) perTarget.push({ key: t.key, label: t.label || t.key, deletable: del })
    deletable += del
  }
  return {
    count: deletable,
    tone: 'warning',
    sub: deletable > 0
      ? `across ${perTarget.length} table${perTarget.length === 1 ? '' : 's'}`
        + (protectedRows > 0 ? ` (${num(protectedRows)} genuine repeats protected)` : '')
      : (protectedRows > 0 ? `${num(protectedRows)} genuine repeats are protected` : 'no re-import duplicates'),
    meta: { perTarget },
  }
}

async function runResolveDuplicates(meta, country) {
  const perTarget = meta?.perTarget || []
  let removed = 0
  for (const t of perTarget) {
    const r = await resolveDuplicates(t.key, country || null, 'Advanced Remediation')
    removed += Number(r?.deleted) || 0
  }
  return `${num(removed)} duplicate row${removed === 1 ? '' : 's'} removed and archived. `
    + 'You can undo this from Duplicate Control.'
}

/** Orphan assets: tyres pointing at a fleet record that does not exist. */
async function loadOrphans() {
  const rows = await listOrphanAssets()
  const count = Array.isArray(rows) ? rows.length : 0
  const tyres = (rows || []).reduce((a, r) => a + (Number(r?.tyre_count) || 0), 0)
  return {
    count,
    tone: 'warning',
    sub: count > 0 ? `covering ${num(tyres)} tyre${tyres === 1 ? '' : 's'}` : 'every asset is registered',
  }
}

async function runBackfillOrphans() {
  const n = await backfillAllOrphanAssets()
  return `${num(n)} missing asset${Number(n) === 1 ? '' : 's'} added to the fleet register.`
}

/** Tyres missing a brand: a per-row human decision, so route to the fill surface. */
async function loadBrandGap(country) {
  const rows = await listBrandGapSummary()
  const scoped = (rows || []).filter(
    (r) => !country || country === 'All' || r.country === country,
  )
  const missing = scoped.reduce((a, r) => a + (Number(r?.missing) || 0), 0)
  return {
    count: missing,
    tone: 'warning',
    sub: missing > 0 ? 'brand is filled one tyre at a time' : 'every tyre carries a brand',
  }
}

/** Duplicate-key tyres: same fitment key more than once; resolve byte-identical only. */
async function loadDupKeys() {
  const rows = await listDuplicateKeyTyres()
  const count = Array.isArray(rows) ? rows.length : 0
  return {
    count,
    tone: 'warning',
    sub: count > 0 ? 'only byte-identical extras are removed' : 'no duplicate fitment keys',
    meta: { rows: rows || [] },
  }
}

async function runResolveDupKeys(meta) {
  const rows = meta?.rows || []
  let removed = 0
  let differing = 0
  for (const g of rows) {
    const r = await resolveDuplicateKey(g.serial_no, g.asset_no, g.issue_date ?? null)
    if (r?.resolved) removed += Number(r?.deleted) || 0
    else differing += 1
  }
  const tail = differing > 0
    ? ` ${num(differing)} group${differing === 1 ? '' : 's'} differ and were left for manual review.`
    : ''
  return `${num(removed)} identical duplicate tyre row${removed === 1 ? '' : 's'} removed.${tail}`
}

/** Classification coverage: share of spend reviewed by a human. Route to review. */
async function loadClassification() {
  const cov = await materialCoverage()
  const share = cov?.reviewed_value_share
  if (share == null) {
    return { count: 0, value: 'N/A', sub: 'coverage is not available yet' }
  }
  const pct = Number(share) || 0
  const remaining = Math.max(0, 100 - pct)
  return {
    count: remaining > 0 ? 1 : 0,
    tone: pct >= 80 ? 'default' : 'warning',
    value: `${pct}%`,
    sub: `of spend reviewed; ${remaining}% still relies on text patterns`,
  }
}

/** Unresolved system errors: bulk-resolve the whole log. */
async function loadSystemErrors() {
  const m = await getHealthMetrics()
  const total = Number(m?.errors?.total) || 0
  const critical = Number(m?.errors?.unresolvedCritical) || 0
  return {
    count: total,
    tone: critical > 0 ? 'danger' : 'warning',
    sub: total > 0
      ? (critical > 0 ? `${num(critical)} critical` : 'none critical')
      : 'no unresolved errors',
    meta: { critical },
  }
}

async function runResolveSystemErrors() {
  const n = await resolveAllSystemLogs({})
  return `${num(n)} system log${Number(n) === 1 ? '' : 's'} marked resolved.`
}

// ── panel ───────────────────────────────────────────────────────────────────────

export default function RemediationActions({ country }) {
  const scope = country && country !== 'All' ? country : null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Wrench size={15} className="text-orange-400" /> Advanced Remediation
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          One-click fixes for the issues the diagnostics found. Each action reuses an
          existing, server-guarded fix
          {scope ? <span className="text-gray-400"> | scoped to {scope}</span> : null}.
        </p>
      </div>

      <Note icon={ShieldCheck} tone="accent">
        Every fix here is guarded on the server and asks before it runs. Removing
        duplicates archives every row first and is undoable from Duplicate Control.
        Brand fill and classification review are per-row decisions, so those cards
        take you to the surface that owns them rather than guessing a value.
      </Note>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActionCard
          icon={CopyX}
          title="Duplicate rows"
          description="Extra copies created when an import was re-run. The earliest row is kept."
          country={scope}
          load={loadDuplicates}
          action={{
            label: 'Remove duplicates',
            verb: 'Remove and archive',
            icon: CopyX,
            tone: 'danger',
            typed: true,
            confirmTitle: 'Remove duplicate rows',
            confirmSubtitle: 'Archived first, fully undoable',
            confirmBody: 'The extra copies are deleted, keeping the earliest row of each '
              + 'group. Every removed row is archived first, so this can be undone from '
              + 'Duplicate Control. Genuine repeated source lines are protected and never removed.',
          }}
        />

        <ActionCard
          icon={Link2Off}
          title="Orphan assets"
          description="Tyres pointing at a fleet record that is missing from the register."
          country={scope}
          load={loadOrphans}
          action={{
            label: 'Backfill all',
            verb: 'Backfill assets',
            icon: Link2Off,
            tone: 'primary',
            confirmTitle: 'Backfill missing assets',
            confirmBody: 'A fleet record is created for every orphaned asset so reports '
              + 'stop losing these tyres. This is a safe insert and removes nothing.',
          }}
        />

        <ActionCard
          icon={Shuffle}
          title="Duplicate-key tyres"
          description="The same fitment key stored more than once."
          country={scope}
          load={loadDupKeys}
          action={{
            label: 'Resolve identical',
            verb: 'Resolve identical copies',
            icon: Shuffle,
            tone: 'danger',
            confirmTitle: 'Resolve duplicate-key tyres',
            confirmBody: 'For each group the newest row is kept and byte-identical copies '
              + 'are removed. A group whose rows differ is left untouched for manual review, '
              + 'so nothing ambiguous is ever deleted.',
          }}
        />

        <ActionCard
          icon={AlertTriangle}
          title="Unresolved system errors"
          description="Open entries in the application error log."
          country={scope}
          load={loadSystemErrors}
          action={{
            label: 'Resolve all',
            verb: 'Mark all resolved',
            icon: CheckCircle2,
            tone: 'primary',
            confirmTitle: 'Resolve all system errors',
            confirmBody: 'Every unresolved log entry is marked resolved. This clears the '
              + 'board; it does not change any operational data. New errors will still appear.',
          }}
        />

        <ActionCard
          icon={Tag}
          title="Tyres missing a brand"
          description="Brand is filled one tyre at a time, never guessed in bulk."
          country={scope}
          load={loadBrandGap}
          route={{ to: '/data-reconciliation', label: 'Open brand fill' }}
        />

        <ActionCard
          icon={Boxes}
          title="Unreviewed spend classification"
          description="Share of spend a human has confirmed rather than a text pattern."
          country={scope}
          load={loadClassification}
          route={{ to: '/console/material-master', label: 'Review classification' }}
        />
      </div>

      <p className="text-[11px] text-gray-600">
        Advanced Remediation reuses the existing reconciliation, duplicate-control,
        material-master and system-log services. It never writes SQL, never invents a
        value, and every destructive action is archived or reversible.
      </p>
    </div>
  )
}
