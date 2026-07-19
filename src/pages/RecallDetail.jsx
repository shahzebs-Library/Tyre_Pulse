import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ShieldAlert, ArrowLeft, AlertTriangle, Search, Lock,
} from 'lucide-react'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/EmptyState'
import * as recallsApi from '../lib/api/recalls'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'

// ── Config shared with the RecallTracker registry so badges read identically ──
const SEVERITY_CFG = {
  Critical: { text: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700',    dot: 'bg-red-500'    },
  High:     { text: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700', dot: 'bg-orange-500' },
  Medium:   { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', dot: 'bg-yellow-500' },
  Low:      { text: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700',   dot: 'bg-blue-500'   },
}

const STATUS_CFG = {
  Active:     { text: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700'    },
  Monitoring: { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700' },
  Closed:     { text: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700'  },
}

function daysBetween(a, b) {
  if (!a || !b) return null
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

function Badge({ label, cfg, small }) {
  const c = cfg ?? { text: 'text-[var(--text-muted)]', bg: 'bg-[var(--input-bg)]', border: 'border-[var(--input-border)]' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${c.text} ${c.bg} ${c.border} ${small ? 'text-[10px]' : ''}`}>
      {c.dot && <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />}
      {label}
    </span>
  )
}

// ── Recall ⇄ tyre matcher (mirrors RecallTracker.matchTyresForRecall exactly) ──
function matchTyres(recall, tyres) {
  if (!recall) return []
  return tyres.filter(t => {
    const brandMatch = t.brand?.toLowerCase().trim() === recall.brand?.toLowerCase().trim()
    if (!brandMatch) return false
    const sizes = recall.affected_sizes ?? []
    const sizeMatch = sizes.length === 0 || sizes.some(s =>
      t.size?.toLowerCase().trim() === s.toLowerCase().trim()
    )
    if (!sizeMatch) return false
    if (recall.affected_serial_prefix) {
      const prefix = recall.affected_serial_prefix.toLowerCase()
      if (!t.serial_number?.toLowerCase().startsWith(prefix)) return false
    }
    return true
  })
}

/**
 * Routed detail page for a single tyre recall (`/recalls/:recallId`). Self-fetches
 * the recall record plus the fleet tyre pool, matches affected tyres, and hosts the
 * recall approval workflow (EntityApprovalPanel) with the same lock semantics the
 * registry drawer used. Converted from the RecallTracker "View" drawer because the
 * record + affected-vehicles table + approval sign-off spanned multiple large
 * sections. RLS remains the real access boundary; useSettings scopes nothing extra
 * here (recalls are RLS-scoped server-side), matching the registry's behaviour.
 */
export default function RecallDetail() {
  const { recallId } = useParams()
  const navigate = useNavigate()
  // Kept for scope-context parity with the registry; recalls are RLS-scoped.
  useSettings()

  const [recall, setRecall]   = useState(null)
  const [tyres, setTyres]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [search, setSearch]   = useState('')

  // Approval-engine gate — locks nothing destructive on this read-first page, but
  // is surfaced as a banner so an in-approval recall is clearly flagged. Mirrors
  // the registry drawer's wfLocked wiring; resets when the record changes.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [recallId])

  const load = useCallback(async () => {
    if (!recallId) { setLoading(false); setRecall(null); return }
    setLoading(true)
    setError(null)
    try {
      const [rec, tyreRes] = await Promise.all([
        recallsApi.getRecall(recallId),
        recallsApi.listRecallTyres(),
      ])
      setRecall(rec || null)
      setTyres(tyreRes?.data ?? [])
    } catch (e) {
      setError(toUserMessage(e, 'Could not load this recall record.'))
      setRecall(null)
    } finally {
      setLoading(false)
    }
  }, [recallId])

  useEffect(() => { load() }, [load])

  const matched = useMemo(() => matchTyres(recall, tyres), [recall, tyres])

  const drawerTyres = useMemo(() => {
    if (!search) return matched
    const s = search.toLowerCase()
    return matched.filter(t =>
      t.serial_number?.toLowerCase().includes(s) ||
      t.asset_no?.toLowerCase().includes(s) ||
      t.site?.toLowerCase().includes(s)
    )
  }, [matched, search])

  const backBtn = (
    <button
      onClick={() => navigate('/recall-tracker')}
      className="inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm rounded-lg transition-colors"
    >
      <ArrowLeft size={14} /> Back to Recalls
    </button>
  )

  // ── States: loading / error / not-found ─────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        {backBtn}
        <SkeletonTable rows={8} cols={7} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backBtn}
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle size={32} className="text-red-400 mx-auto mb-2" />
            <p className="text-red-400 font-medium">Could not load recall</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
            <button onClick={load} className="mt-3 px-4 py-2 bg-blue-600 rounded-lg text-sm text-white hover:bg-blue-500">
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!recall) {
    return (
      <div className="space-y-4">
        {backBtn}
        <EmptyState
          icon={ShieldAlert}
          title="Recall not found"
          description={`No recall record matches "${recallId}". It may have been closed out or deleted.`}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          {backBtn}
          <div>
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Recall Record</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <ShieldAlert className="text-red-400 shrink-0" size={18} />
              <h1 className="text-lg font-bold text-[var(--text-primary)]">{recall.recall_number}</h1>
              <Badge label={recall.severity} cfg={SEVERITY_CFG[recall.severity]} small />
              <Badge label={recall.status} cfg={STATUS_CFG[recall.status]} small />
            </div>
            <p className="text-[var(--text-muted)] text-sm mt-1">{recall.brand}{recall.description ? ` - ${recall.description}` : ''}</p>
            {recall.action_required && (
              <p className="text-xs text-[var(--text-muted)] mt-1">{recall.action_required}</p>
            )}
          </div>
        </div>
      </div>

      {/* Approval & Workflow Engine — safety-recall sign-off */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 space-y-3">
        <EntityApprovalPanel
          entityType="recall"
          entityId={recall.id}
          entityLabel={recall.recall_number || recall.brand || recall.id}
          context={{
            severity: recall.severity,
            affected_count: matched.length,
            brand: recall.brand,
            status: recall.status,
            country: recall.country,
          }}
          onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
          title="Recall Approval"
        />
        {wfLocked && (
          <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Lock size={12} /> Locked, in approval
          </p>
        )}
      </div>

      {/* Affected tyres — count + search */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-[var(--input-bg)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="font-bold text-orange-400 text-lg">
            {matched.length} affected fleet {matched.length === 1 ? 'tyre' : 'tyres'}
          </span>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={13} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search serial, asset, site..."
              className="pl-7 pr-3 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-600 w-full sm:w-64"
            />
          </div>
        </div>

        {/* Affected tyres table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--surface-1)] border-b border-[var(--input-border)]">
              <tr className="text-[var(--text-muted)]">
                <th className="px-3 py-2 text-left">Serial</th>
                <th className="px-3 py-2 text-left">Asset</th>
                <th className="px-3 py-2 text-left">Position</th>
                <th className="px-3 py-2 text-left">Site</th>
                <th className="px-3 py-2 text-left">Country</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Days Fitted</th>
              </tr>
            </thead>
            <tbody>
              {drawerTyres.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-[var(--text-muted)]">
                    {matched.length === 0
                      ? 'No fleet tyres match this recall criteria'
                      : 'No results for current search'
                    }
                  </td>
                </tr>
              )}
              {drawerTyres.map((t, i) => {
                const daysOn = t.issue_date ? daysBetween(t.issue_date, t.km_at_removal ? null : new Date().toISOString().slice(0, 10)) : null
                return (
                  <motion.tr
                    key={t.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="border-b border-[var(--input-border)] hover:bg-[var(--input-bg)]"
                  >
                    <td className="px-3 py-2 font-mono text-blue-300">{t.serial_number}</td>
                    <td className="px-3 py-2 text-[var(--text-dim)]">{t.asset_no}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{t.position}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{t.site}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{t.country}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        t.km_at_removal
                          ? 'bg-gray-700 text-gray-300'
                          : 'bg-green-900/40 text-green-400 border border-green-700/50'
                      }`}>
                        {t.km_at_removal ? 'Removed' : 'Fitted'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{daysOn != null ? `${daysOn}d` : 'N/A'}</td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
