/**
 * Reports - mobile PDF generation & sharing
 *
 * Available to: admin · manager · director · reporter
 * Generates a fleet summary PDF with KPIs, risk breakdown, top sites,
 * and open actions. Shared via expo-sharing or print dialog.
 */

import { useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  StatusBar, Alert, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { isAdminOrAbove } from '../../../lib/types'

const REPORT_TYPES = [
  {
    id: 'fleet_summary',
    title: 'Fleet Summary Report',
    desc: 'Overall fleet KPIs, risk breakdown, top sites by cost',
    icon: 'bar-chart-outline',
    color: '#3b82f6',
  },
  {
    id: 'risk_report',
    title: 'Risk & Critical Tyres',
    desc: 'All Critical and High risk tyre records with details',
    icon: 'warning-outline',
    color: '#dc2626',
  },
  {
    id: 'open_actions',
    title: 'Open Corrective Actions',
    desc: 'All open work orders sorted by priority',
    icon: 'construct-outline',
    color: '#f59e0b',
  },
  {
    id: 'site_summary',
    title: 'Site Breakdown',
    desc: 'Record count and cost per site',
    icon: 'location-outline',
    color: '#16a34a',
  },
]

export default function ReportsScreen() {
  const { profile } = useAuth()
  const role = profile?.role ?? null
  const elevated = isAdminOrAbove(role)
  const [generating, setGenerating] = useState<string | null>(null)

  async function generate(reportId: string) {
    if (generating) return
    setGenerating(reportId)
    try {
      let html = ''
      if (reportId === 'fleet_summary')  html = await buildFleetSummary(profile?.site ?? null, elevated)
      if (reportId === 'risk_report')    html = await buildRiskReport(profile?.site ?? null, elevated)
      if (reportId === 'open_actions')   html = await buildOpenActions(profile?.site ?? null, elevated)
      if (reportId === 'site_summary')   html = await buildSiteSummary(profile?.site ?? null, elevated)

      const { uri } = await Print.printToFileAsync({ html })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Report' })
      } else {
        Alert.alert('Saved', 'PDF saved to device.')
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not generate report.')
    } finally {
      setGenerating(null)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0fdf4" />

      <View style={styles.header}>
        <Text style={styles.title}>Reports</Text>
        <Text style={styles.subtitle}>Generate & share PDF reports</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color="#3b82f6" />
          <Text style={styles.infoText}>
            Reports are generated from live data and exported as PDF.{elevated ? '' : ` Filtered to ${profile?.site ?? 'your site'}.`}
          </Text>
        </View>

        {REPORT_TYPES.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.card, generating === r.id && styles.cardBusy]}
            onPress={() => generate(r.id)}
            activeOpacity={0.75}
            disabled={!!generating}
          >
            <View style={[styles.iconBox, { backgroundColor: r.color + '18' }]}>
              <Ionicons name={r.icon as any} size={24} color={r.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{r.title}</Text>
              <Text style={styles.cardDesc}>{r.desc}</Text>
            </View>
            {generating === r.id ? (
              <ActivityIndicator size="small" color={r.color} />
            ) : (
              <Ionicons name="download-outline" size={20} color="#94a3b8" />
            )}
          </TouchableOpacity>
        ))}

        <Text style={styles.hint}>
          Reports are generated from live data at the time of export. PDF is shared via your device's share sheet.
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

// ── Report builders ────────────────────────────────────────────────────────────

const css = `
  * { font-family: -apple-system, Helvetica, Arial, sans-serif; box-sizing: border-box; }
  body { color: #0f172a; padding: 24px; font-size: 12px; margin: 0; }
  h1  { font-size: 20px; margin: 0 0 2px; color: #0f172a; }
  h2  { font-size: 13px; color: #16a34a; border-bottom: 2px solid #dcfce7; padding-bottom: 4px; margin: 20px 0 8px; }
  .sub { color: #64748b; font-size: 11px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #f8fafc; padding: 6px 8px; text-align: left; font-size: 11px; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
  .kpis { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
  .kpi  { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; min-width: 120px; }
  .kpi-v { font-size: 22px; font-weight: 800; color: #0f172a; }
  .kpi-l { font-size: 11px; color: #64748b; margin-top: 2px; }
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
function footer(): string { return `<footer>Generated ${new Date().toLocaleString()} · TyrePulse Inspector</footer></body></html>` }
function esc(v: any): string { return v == null ? '-' : String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)) }
function money(n: any): string { return n == null ? '-' : 'SAR ' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) }
function riskBadge(r: string | null): string {
  const cls = r === 'Critical' ? 'cr' : r === 'High' ? 'hi' : r === 'Medium' ? 'me' : 'lo'
  return `<span class="badge ${cls}">${esc(r ?? 'Unknown')}</span>`
}

async function buildFleetSummary(site: string | null, elevated: boolean): Promise<string> {
  let q = supabase.from('tyre_records').select('id,asset_no,brand,site,risk_level,cost_per_tyre,issue_date').order('issue_date', { ascending: false }).limit(5000)
  if (!elevated && site) q = q.eq('site', site)
  const { data } = await q
  const records = data ?? []

  const totalCost = records.reduce((s: number, r: any) => s + (Number(r.cost_per_tyre) || 0), 0)
  const byRisk: Record<string, number> = {}
  records.forEach((r: any) => { const k = r.risk_level ?? 'Unknown'; byRisk[k] = (byRisk[k] ?? 0) + 1 })

  const bySite: Record<string, { count: number; cost: number }> = {}
  records.forEach((r: any) => {
    const s = r.site ?? 'Unknown'
    if (!bySite[s]) bySite[s] = { count: 0, cost: 0 }
    bySite[s].count++; bySite[s].cost += Number(r.cost_per_tyre) || 0
  })
  const topSites = Object.entries(bySite).sort((a, b) => b[1].cost - a[1].cost).slice(0, 10)

  return header('Fleet Summary Report', `${elevated ? 'All sites' : site ?? 'All'} · ${new Date().toLocaleDateString()}`)
    + `<div class="kpis">
        <div class="kpi"><div class="kpi-v">${records.length.toLocaleString()}</div><div class="kpi-l">Total Records</div></div>
        <div class="kpi"><div class="kpi-v">${money(totalCost)}</div><div class="kpi-l">Total Cost</div></div>
        <div class="kpi"><div class="kpi-v">${byRisk['Critical'] ?? 0}</div><div class="kpi-l">Critical Risk</div></div>
        <div class="kpi"><div class="kpi-v">${byRisk['High'] ?? 0}</div><div class="kpi-l">High Risk</div></div>
      </div>
      <h2>Risk Breakdown</h2>
      <table><tr><th>Risk Level</th><th>Count</th><th>% of Total</th></tr>
        ${['Critical','High','Medium','Low'].map(r => `<tr><td>${riskBadge(r)}</td><td>${byRisk[r] ?? 0}</td><td>${records.length > 0 ? Math.round(((byRisk[r] ?? 0) / records.length) * 100) : 0}%</td></tr>`).join('')}
      </table>
      <h2>Top Sites by Cost</h2>
      <table><tr><th>Site</th><th>Records</th><th>Total Cost</th></tr>
        ${topSites.map(([s, v]) => `<tr><td>${esc(s)}</td><td>${v.count}</td><td>${money(v.cost)}</td></tr>`).join('')}
      </table>`
    + footer()
}

async function buildRiskReport(site: string | null, elevated: boolean): Promise<string> {
  let q = supabase.from('tyre_records')
    .select('asset_no,serial_no,brand,site,risk_level,cost_per_tyre,issue_date,description')
    .in('risk_level', ['Critical', 'High'])
    .order('risk_level').order('issue_date', { ascending: false }).limit(500)
  if (!elevated && site) q = q.eq('site', site)
  const { data } = await q
  const records = data ?? []

  return header('Risk & Critical Tyres Report', `${records.length} Critical/High risk records · ${new Date().toLocaleDateString()}`)
    + `<h2>Critical & High Risk Records (${records.length})</h2>
       <table>
         <tr><th>Asset</th><th>Serial</th><th>Brand</th><th>Site</th><th>Risk</th><th>Cost</th><th>Date</th></tr>
         ${records.map((r: any) => `<tr>
           <td><b>${esc(r.asset_no)}</b></td>
           <td>${esc(r.serial_no)}</td>
           <td>${esc(r.brand)}</td>
           <td>${esc(r.site)}</td>
           <td>${riskBadge(r.risk_level)}</td>
           <td>${money(r.cost_per_tyre)}</td>
           <td>${esc(r.issue_date)}</td>
         </tr>`).join('')}
       </table>`
    + footer()
}

async function buildOpenActions(site: string | null, elevated: boolean): Promise<string> {
  let q = supabase.from('corrective_actions')
    .select('title,priority,site,asset_no,assigned_to,status,due_date,created_at')
    .not('status', 'in', '("Closed")')
    .order('priority').order('due_date', { ascending: true }).limit(200)
  if (!elevated && site) q = q.eq('site', site)
  const { data } = await q
  const actions = data ?? []

  const prColor: Record<string, string> = { Critical: 'cr', High: 'hi', Medium: 'me', Low: 'lo' }
  const stColor: Record<string, string> = { Open: 'oc', 'In Progress': 'ip', Resolved: 're' }

  return header('Open Corrective Actions', `${actions.length} open action${actions.length !== 1 ? 's' : ''} · ${new Date().toLocaleDateString()}`)
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

async function buildSiteSummary(site: string | null, elevated: boolean): Promise<string> {
  let q = supabase.from('tyre_records').select('site,cost_per_tyre,risk_level').limit(10000)
  if (!elevated && site) q = q.eq('site', site)
  const { data } = await q
  const records = data ?? []

  const map: Record<string, { count: number; cost: number; critical: number; high: number }> = {}
  records.forEach((r: any) => {
    const s = r.site ?? 'Unknown'
    if (!map[s]) map[s] = { count: 0, cost: 0, critical: 0, high: 0 }
    map[s].count++
    map[s].cost += Number(r.cost_per_tyre) || 0
    if (r.risk_level === 'Critical') map[s].critical++
    if (r.risk_level === 'High') map[s].high++
  })

  const rows = Object.entries(map).sort((a, b) => b[1].cost - a[1].cost)

  return header('Site Breakdown Report', `${rows.length} site${rows.length !== 1 ? 's' : ''} · ${new Date().toLocaleDateString()}`)
    + `<table>
         <tr><th>Site</th><th>Records</th><th>Total Cost</th><th>Avg Cost</th><th>Critical</th><th>High</th></tr>
         ${rows.map(([s, v]) => `<tr>
           <td><b>${esc(s)}</b></td>
           <td>${v.count}</td>
           <td>${money(v.cost)}</td>
           <td>${money(v.count > 0 ? v.cost / v.count : 0)}</td>
           <td>${v.critical > 0 ? `<span class="badge cr">${v.critical}</span>` : '0'}</td>
           <td>${v.high > 0 ? `<span class="badge hi">${v.high}</span>` : '0'}</td>
         </tr>`).join('')}
       </table>`
    + footer()
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: '#f0fdf4' },
  header: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  title:    { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },

  content: { padding: 16, gap: 12, paddingBottom: 40 },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#eff6ff', borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: '#bfdbfe',
  },
  infoText: { flex: 1, fontSize: 12, color: '#1e40af', lineHeight: 18 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardBusy: { opacity: 0.7 },
  iconBox:  { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle:{ fontSize: 15, fontWeight: '700', color: '#0f172a' },
  cardDesc: { fontSize: 12, color: '#64748b', marginTop: 2 },

  hint: { fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 16, marginTop: 4 },
})
