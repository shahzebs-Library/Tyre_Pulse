/**
 * Reports - mobile report generation & sharing
 *
 * Available to: admin, manager, director, reporter, inspector, tyre_man
 * (see lib/permissions.ts `reports` module).
 *
 * EXECUTIVE REPORT (authoritative): driven by ONE server-computed snapshot
 * (lib/reportSnapshot.ts -> get_report_snapshot_authed), the same org-scoped
 * aggregate the WEB executive report uses. The on-screen preview AND the shared
 * PDF are rendered from that same snapshot object, so screen == PDF == web (one
 * dataset, one set of KPI values, one generated_at, one company / branding). If
 * the live snapshot is unavailable we say so honestly and never fall back to
 * divergent local numbers.
 *
 * OPERATIONAL EXPORTS (live line items): the Risk and Open-Actions exports below
 * are row-level operational lists (individual records), not aggregate KPIs, so
 * they legitimately query live data. Field roles are scoped to their OWN site.
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  View, ScrollView, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, TextInput,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { supabase } from '../../../lib/supabase'
import { toUserMessage } from '../../../lib/safeError'
import { useAuth } from '../../../contexts/AuthContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { isAdminOrAbove } from '../../../lib/types'
import { Screen, AppText, StatTile } from '../../../components/ui'
import { Theme, spacing, radius } from '../../../lib/theme'
import {
  fetchReportSnapshot, type SnapshotResult, type ReportSnapshot,
} from '../../../lib/reportSnapshot'
import { buildExecReportHtml } from '../../../lib/execReportPdf'

type TintKey = keyof Theme['tint']

type DateRange = { from: string; to: string }

/** Local YYYY-MM-DD (avoids the UTC shift that toISOString() introduces). */
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
function daysAgo(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days); return isoDay(d)
}
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim())

const money = (n: any) => n == null ? 'N/A' : 'SAR ' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })

// Line-item operational exports (live queries; NOT aggregate KPI snapshots).
const OPERATIONAL_EXPORTS: {
  id: string; title: string; desc: string; icon: string; tint: TintKey
}[] = [
  {
    id: 'risk_report',
    title: 'Risk & Critical Tyres',
    desc: 'Line-item list of Critical and High risk tyre records',
    icon: 'warning-outline',
    tint: 'red',
  },
  {
    id: 'open_actions',
    title: 'Open Corrective Actions',
    desc: 'Line-item list of open work orders by priority',
    icon: 'construct-outline',
    tint: 'amber',
  },
]

import { withModuleGuard } from '../../../components/ModuleGuard'

export default withModuleGuard(ReportsScreen, 'reports')

function ReportsScreen() {
  const { profile } = useAuth()
  const { theme } = useTheme()
  const { language } = useLanguage()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const role = profile?.role ?? null
  const elevated = isAdminOrAbove(role)
  const [generating, setGenerating] = useState<string | null>(null)
  // Report date range. Defaults sensibly to the last 30 days; a chosen range
  // scopes every report and is printed on the PDF.
  const [fromDate, setFromDate] = useState(daysAgo(30))
  const [toDate, setToDate] = useState(isoDay(new Date()))

  // The authoritative server snapshot. Everything in the Executive Report section
  // (preview + PDF) renders from this ONE object.
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null)
  const [snapLoading, setSnapLoading] = useState(true)

  // Resolve the effective range: fall back to last-30-days when a field is blank
  // or not a complete YYYY-MM-DD, so a report always covers a sensible window.
  const effectiveRange = useCallback((): DateRange => ({
    from: isDay(fromDate) ? fromDate.trim() : daysAgo(30),
    to: isDay(toDate) ? toDate.trim() : isoDay(new Date()),
  }), [fromDate, toDate])

  function setRange(days: number) {
    setFromDate(daysAgo(days)); setToDate(isoDay(new Date()))
  }

  // Fetch the server snapshot for the current range. Field roles pass their site so
  // the snapshot is scoped exactly like the operational exports below.
  const loadSnapshot = useCallback(async () => {
    setSnapLoading(true)
    const range = effectiveRange()
    const res = await fetchReportSnapshot({
      from: range.from,
      to: range.to,
      site: elevated ? null : (profile?.site ?? null),
    })
    setSnapshot(res)
    setSnapLoading(false)
  }, [effectiveRange, elevated, profile?.site])

  useEffect(() => { loadSnapshot() }, [loadSnapshot])

  // Share the executive PDF built from the SAME snapshot rendered on screen.
  async function shareExecPdf() {
    if (generating) return
    if (!snapshot || snapshot.ok !== true) return
    setGenerating('exec')
    try {
      const html = buildExecReportHtml(snapshot, { language, elevated })
      const { uri } = await Print.printToFileAsync({ html })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Executive Report' })
      } else {
        Alert.alert('Saved', 'PDF saved to device.')
      }
    } catch (e: any) {
      Alert.alert('Error', toUserMessage(e, 'Could not generate report.'))
    } finally {
      setGenerating(null)
    }
  }

  async function generateOperational(reportId: string) {
    if (generating) return
    setGenerating(reportId)
    try {
      const range = effectiveRange()
      let html = ''
      if (reportId === 'risk_report')  html = await buildRiskReport(profile?.site ?? null, elevated, range)
      if (reportId === 'open_actions') html = await buildOpenActions(profile?.site ?? null, elevated, range)

      const { uri } = await Print.printToFileAsync({ html })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Report' })
      } else {
        Alert.alert('Saved', 'PDF saved to device.')
      }
    } catch (e: any) {
      Alert.alert('Error', toUserMessage(e, 'Could not generate report.'))
    } finally {
      setGenerating(null)
    }
  }

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <AppText variant="h2">Reports</AppText>
        <AppText variant="caption" color="secondary">Executive snapshot and operational exports</AppText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Date range - scopes every report; defaults to the last 30 days. */}
        <View style={styles.rangeCard}>
          <AppText variant="label" color="secondary">Date range</AppText>
          <View style={styles.presetRow}>
            {[
              { label: '30 days', days: 30 },
              { label: '90 days', days: 90 },
              { label: '1 year', days: 365 },
            ].map(p => {
              const active = fromDate === daysAgo(p.days) && toDate === isoDay(new Date())
              return (
                <TouchableOpacity
                  key={p.days}
                  style={[styles.presetBtn, active && { backgroundColor: theme.color.primary, borderColor: theme.color.primary }]}
                  onPress={() => setRange(p.days)}
                  activeOpacity={0.8}
                >
                  <AppText variant="caption" style={{ color: active ? theme.color.onPrimary : theme.color.textSecondary, fontWeight: '700' }}>
                    {p.label}
                  </AppText>
                </TouchableOpacity>
              )
            })}
          </View>
          <View style={styles.rangeInputs}>
            <View style={styles.rangeField}>
              <AppText variant="micro" color="muted">From</AppText>
              <TextInput
                style={styles.dateInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.color.textMuted}
                value={fromDate}
                onChangeText={setFromDate}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
            <View style={styles.rangeField}>
              <AppText variant="micro" color="muted">To</AppText>
              <TextInput
                style={styles.dateInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.color.textMuted}
                value={toDate}
                onChangeText={setToDate}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
          </View>
          <TouchableOpacity style={styles.applyBtn} onPress={loadSnapshot} activeOpacity={0.8} disabled={snapLoading}>
            <Ionicons name="refresh-outline" size={16} color={theme.color.primaryDark} />
            <AppText variant="caption" style={{ color: theme.color.primaryDark, fontWeight: '700' }}>
              Refresh live figures
            </AppText>
          </TouchableOpacity>
        </View>

        {/* ── Executive Report: single server snapshot (screen == PDF == web) ── */}
        <AppText variant="label" color="secondary" style={styles.sectionLabel}>Executive Report</AppText>
        <ExecutiveReportCard
          styles={styles}
          theme={theme}
          snapshot={snapshot}
          loading={snapLoading}
          generating={generating === 'exec'}
          elevated={elevated}
          site={profile?.site ?? null}
          onRetry={loadSnapshot}
          onShare={shareExecPdf}
        />

        {/* ── Operational exports: live line-item lists ── */}
        <AppText variant="label" color="secondary" style={styles.sectionLabel}>Operational exports</AppText>
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={theme.color.info.base} />
          <AppText variant="caption" color="info" style={styles.infoText}>
            Line-item lists generated from live records at export time.{elevated ? '' : ` Filtered to ${profile?.site ?? 'your site'}.`}
          </AppText>
        </View>

        {OPERATIONAL_EXPORTS.map(r => {
          const tint = theme.tint[r.tint]
          return (
            <TouchableOpacity
              key={r.id}
              style={[styles.card, generating === r.id && styles.cardBusy]}
              onPress={() => generateOperational(r.id)}
              activeOpacity={0.8}
              disabled={!!generating}
            >
              <View style={[styles.iconBox, { backgroundColor: tint.bg }]}>
                <Ionicons name={r.icon as any} size={24} color={tint.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="title">{r.title}</AppText>
                <AppText variant="caption" color="secondary" style={{ marginTop: 2 }}>{r.desc}</AppText>
              </View>
              {generating === r.id ? (
                <ActivityIndicator size="small" color={theme.color.primary} />
              ) : (
                <Ionicons name="download-outline" size={20} color={theme.color.textMuted} />
              )}
            </TouchableOpacity>
          )
        })}

        <AppText variant="caption" color="muted" center style={styles.hint}>
          The Executive Report matches the web executive report for the same filters. PDFs are shared via your device share sheet.
        </AppText>
      </ScrollView>
    </Screen>
  )
}

// ── Executive report card (preview + share, both from the one snapshot) ──────────

function ExecutiveReportCard({
  styles, theme, snapshot, loading, generating, elevated, site, onRetry, onShare,
}: {
  styles: ReturnType<typeof makeStyles>
  theme: Theme
  snapshot: SnapshotResult | null
  loading: boolean
  generating: boolean
  elevated: boolean
  site: string | null
  onRetry: () => void
  onShare: () => void
}) {
  if (loading) {
    return (
      <View style={[styles.card, styles.execCard]}>
        <ActivityIndicator size="small" color={theme.color.primary} />
        <AppText variant="caption" color="muted" style={{ marginTop: spacing.sm }}>Loading live figures...</AppText>
      </View>
    )
  }

  if (!snapshot || snapshot.ok !== true) {
    const reason = snapshot && snapshot.ok === false ? snapshot.reason : 'error'
    const msg = reason === 'network'
      ? 'Network problem. Check your connection and try again.'
      : 'Live report data is unavailable right now. The official figures come from the server; no local estimate is shown to avoid mismatched numbers.'
    return (
      <View style={[styles.card, styles.execCard]}>
        <View style={[styles.iconBox, { backgroundColor: theme.color.danger.soft }]}>
          <Ionicons name="cloud-offline-outline" size={24} color={theme.color.danger.base} />
        </View>
        <AppText variant="title">Executive Report unavailable</AppText>
        <AppText variant="caption" color="muted" center style={{ marginTop: 4 }}>{msg}</AppText>
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.8}>
          <Ionicons name="refresh" size={16} color={theme.color.onPrimary} />
          <AppText variant="caption" style={{ color: theme.color.onPrimary, fontWeight: '700' }}>Retry</AppText>
        </TouchableOpacity>
      </View>
    )
  }

  const snap: ReportSnapshot = snapshot
  const k = snap.kpis
  const generated = (() => {
    const d = new Date(snap.generated_at)
    return isNaN(d.getTime()) ? snap.generated_at : d.toLocaleString()
  })()

  return (
    <View style={[styles.card, styles.execCard]}>
      <View style={styles.execHead}>
        <View style={{ flex: 1 }}>
          <AppText variant="title">{snap.company}</AppText>
          <AppText variant="micro" color="muted">
            {elevated ? 'All sites' : (site ?? 'Your site')} | Snapshot {generated}
          </AppText>
        </View>
        <View style={[styles.liveChip, { backgroundColor: theme.color.success.soft }]}>
          <Ionicons name="server-outline" size={12} color={theme.color.success.base} />
          <AppText variant="micro" style={{ color: theme.color.success.base, fontWeight: '700' }}>Live server data</AppText>
        </View>
      </View>

      <View style={styles.kpiGrid}>
        <StatTile label="Fleet" value={k.fleet.toLocaleString()} icon="car-outline" tint="blue" />
        <StatTile label="Tyre records" value={k.tyres.toLocaleString()} icon="ellipse-outline" tint="green" />
      </View>
      <View style={styles.kpiGrid}>
        <StatTile label="Tyre spend" value={money(k.tyre_spend)} icon="cash-outline" tint="amber" />
        <StatTile label="Open accidents" value={k.open_accidents.toLocaleString()} icon="warning-outline" tint="red" />
      </View>
      <View style={styles.kpiGrid}>
        <StatTile label="Inspections" value={k.inspections.toLocaleString()} icon="clipboard-outline" tint="blue" />
        <StatTile label="Open work orders" value={k.work_orders_open.toLocaleString()} icon="construct-outline" tint="amber" />
      </View>

      <View style={styles.costRow}>
        <AppText variant="caption" color="secondary">Total operating cost</AppText>
        <AppText variant="title">{money(snap.cost.total_cost)}</AppText>
      </View>
      <View style={styles.costRow}>
        <AppText variant="caption" color="secondary">Cost per km</AppText>
        <AppText variant="caption">{snap.cost.cost_per_km == null ? 'N/A' : 'SAR ' + snap.cost.cost_per_km.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' / km'}</AppText>
      </View>

      <TouchableOpacity
        style={[styles.shareBtn, generating && styles.cardBusy]}
        onPress={onShare}
        activeOpacity={0.85}
        disabled={generating}
      >
        {generating ? (
          <ActivityIndicator size="small" color={theme.color.onPrimary} />
        ) : (
          <Ionicons name="share-outline" size={18} color={theme.color.onPrimary} />
        )}
        <AppText variant="title" style={{ color: theme.color.onPrimary }}>Share Executive PDF</AppText>
      </TouchableOpacity>
    </View>
  )
}

// ── Operational report builders (live line-item lists) ───────────────────────────

const css = `
  * { font-family: -apple-system, Helvetica, Arial, sans-serif; box-sizing: border-box; }
  body { color: #0f172a; padding: 24px; font-size: 12px; margin: 0; }
  h1  { font-size: 20px; margin: 0 0 2px; color: #0f172a; }
  h2  { font-size: 13px; color: #16a34a; border-bottom: 2px solid #dcfce7; padding-bottom: 4px; margin: 20px 0 8px; }
  .sub { color: #64748b; font-size: 11px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #f8fafc; padding: 6px 8px; text-align: left; font-size: 11px; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; }
  .cr { background: #fef2f2; color: #dc2626; } .hi { background: #fff7ed; color: #ea580c; }
  .me { background: #fffbeb; color: #f59e0b; } .lo { background: #f0fdf4; color: #16a34a; }
  .oc { background: #fef2f2; color: #dc2626; } .ip { background: #fffbeb; color: #f59e0b; }
  .re { background: #eff6ff; color: #3b82f6; } .cl { background: #f8fafc; color: #6b7280; }
  footer { margin-top: 24px; font-size: 10px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 10px; }
`

function header(title: string, subtitle: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><style>${css}</style></head><body>
    <h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p>`
}
function footer(): string { return `<footer>Generated ${new Date().toLocaleString()} | TyrePulse Inspector | live line-item export</footer></body></html>` }
function esc(v: any): string { return v == null ? '-' : String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)) }
function moneyHtml(n: any): string { return n == null ? '-' : 'SAR ' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) }
function riskBadge(r: string | null): string {
  const cls = r === 'Critical' ? 'cr' : r === 'High' ? 'hi' : r === 'Medium' ? 'me' : 'lo'
  return `<span class="badge ${cls}">${esc(r ?? 'Unknown')}</span>`
}

async function buildRiskReport(site: string | null, elevated: boolean, range: DateRange): Promise<string> {
  let q = supabase.from('tyre_records')
    .select('asset_no,serial_no,brand,site,risk_level,cost_per_tyre,issue_date,description')
    .in('risk_level', ['Critical', 'High'])
    .gte('issue_date', range.from).lte('issue_date', range.to)
    .order('risk_level').order('issue_date', { ascending: false }).limit(500)
  if (!elevated && site) q = q.eq('site', site)
  const { data } = await q
  const records = data ?? []

  return header('Risk & Critical Tyres Report', `${records.length} Critical/High risk records | ${range.from} to ${range.to}`)
    + `<h2>Critical & High Risk Records (${records.length})</h2>
       <table>
         <tr><th>Asset</th><th>Serial</th><th>Brand</th><th>Site</th><th>Risk</th><th>Cost</th><th>Date</th></tr>
         ${records.map((r: any) => `<tr>
           <td><b>${esc(r.asset_no)}</b></td>
           <td>${esc(r.serial_no)}</td>
           <td>${esc(r.brand)}</td>
           <td>${esc(r.site)}</td>
           <td>${riskBadge(r.risk_level)}</td>
           <td>${moneyHtml(r.cost_per_tyre)}</td>
           <td>${esc(r.issue_date)}</td>
         </tr>`).join('')}
       </table>`
    + footer()
}

async function buildOpenActions(site: string | null, elevated: boolean, range: DateRange): Promise<string> {
  let q = supabase.from('corrective_actions')
    .select('title,priority,site,asset_no,assigned_to,status,due_date,created_at')
    .not('status', 'in', '("Closed")')
    .gte('created_at', range.from).lte('created_at', range.to + 'T23:59:59')
    .order('priority').order('due_date', { ascending: true }).limit(200)
  if (!elevated && site) q = q.eq('site', site)
  const { data } = await q
  const actions = data ?? []

  const prColor: Record<string, string> = { Critical: 'cr', High: 'hi', Medium: 'me', Low: 'lo' }
  const stColor: Record<string, string> = { Open: 'oc', 'In Progress': 'ip', Resolved: 're' }

  return header('Open Corrective Actions', `${actions.length} open action${actions.length !== 1 ? 's' : ''} | ${range.from} to ${range.to}`)
    + `<table>
         <tr><th>Title</th><th>Priority</th><th>Status</th><th>Asset</th><th>Site</th><th>Assigned</th><th>Due</th></tr>
         ${actions.map((a: any) => `<tr>
           <td>${esc(a.title)}</td>
           <td><span class="badge ${prColor[a.priority ?? ''] ?? ''}">${esc(a.priority)}</span></td>
           <td><span class="badge ${stColor[a.status ?? ''] ?? ''}">${esc(a.status)}</span></td>
           <td>${esc(a.asset_no)}</td>
           <td>${esc(a.site)}</td>
           <td>${esc(a.assigned_to)}</td>
           <td>${a.due_date ? esc(a.due_date.slice(0, 10)) : '-'}</td>
         </tr>`).join('')}
       </table>`
    + footer()
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    header: {
      paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
    sectionLabel: { marginTop: spacing.md },
    infoBox: {
      flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
      backgroundColor: c.info.soft, borderRadius: radius.lg,
      padding: spacing.md, borderWidth: 1, borderColor: c.border,
    },
    infoText: { flex: 1, lineHeight: 18 },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
      backgroundColor: c.surface, borderRadius: radius.xl, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border,
      shadowColor: c.shadow, shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 1, shadowRadius: 6, elevation: 2,
    },
    cardBusy: { opacity: 0.7 },
    execCard: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm },
    execHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    liveChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.md,
    },
    kpiGrid: { flexDirection: 'row', gap: spacing.md },
    costRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    shareBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
      backgroundColor: c.primary, borderRadius: radius.lg, paddingVertical: spacing.md,
      marginTop: spacing.sm,
    },
    retryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
      backgroundColor: c.primary, borderRadius: radius.lg,
      paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md,
    },
    iconBox: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    hint: { marginTop: spacing.xs },
    rangeCard: {
      backgroundColor: c.surface, borderRadius: radius.xl, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border, gap: spacing.md,
    },
    presetRow: { flexDirection: 'row', gap: spacing.sm },
    presetBtn: {
      flex: 1, alignItems: 'center', paddingVertical: spacing.sm,
      borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surfaceAlt,
    },
    rangeInputs: { flexDirection: 'row', gap: spacing.md },
    rangeField: { flex: 1, gap: spacing.xs },
    dateInput: {
      height: 42, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border,
      backgroundColor: c.surfaceAlt, paddingHorizontal: spacing.md,
      fontSize: 14, color: c.text, fontWeight: '600',
    },
    applyBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      paddingVertical: spacing.sm, borderRadius: radius.md,
      borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surfaceAlt,
    },
  })
}
