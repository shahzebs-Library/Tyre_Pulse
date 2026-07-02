/**
 * Fleet AI Command Center
 *
 * Agentic pipeline: classify intent → fetch live Supabase context → call
 * claude-haiku via the `chat-ai` edge function → render structured response
 * with embedded action buttons.
 *
 * Access: admin · manager · director  (canUseAI)
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator,
  ScrollView, Animated, Easing, Pressable,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { canUseAI } from '../../../lib/permissions'

// ── Types ─────────────────────────────────────────────────────────────────────

type Intent =
  | 'fleet_overview'
  | 'risk_analysis'
  | 'cost_analysis'
  | 'work_orders'
  | 'tyre_analysis'
  | 'site_analysis'
  | 'vehicle_query'
  | 'general'

type ActionTag =
  | 'view_critical'
  | 'view_workorders'
  | 'view_analytics'
  | 'view_reports'
  | 'view_records'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions?: ActionTag[]
  timestamp: Date
  dataLabel?: string
}

// ── Intent Classifier ─────────────────────────────────────────────────────────

const INTENT_KEYWORDS: Record<Intent, string[]> = {
  fleet_overview: ['overview', 'summary', 'health', 'status', 'kpi', 'dashboard', 'how is', 'how are', 'performance'],
  risk_analysis:  ['risk', 'critical', 'dangerous', 'urgent', 'alert', 'warning', 'unsafe', 'high risk', 'worst'],
  cost_analysis:  ['cost', 'expense', 'spend', 'money', 'budget', 'financial', 'sar', 'price', 'expensive', 'cheap'],
  work_orders:    ['work order', 'action', 'overdue', 'maintenance', 'repair', 'corrective', 'pending task', 'open task'],
  tyre_analysis:  ['tyre', 'tire', 'brand', 'wear', 'pressure', 'tread', 'michelin', 'bridgestone', 'goodyear', 'dunlop'],
  site_analysis:  ['site', 'location', 'branch', 'depot', 'region', 'area', 'yard'],
  vehicle_query:  ['vehicle', 'truck', 'asset', 'fleet size', 'trailer', 'bus', 'lorry', 'how many vehicles'],
  general:        [],
}

function classifyIntent(text: string): Intent {
  const lower = text.toLowerCase()
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as [Intent, string[]][]) {
    if (intent === 'general') continue
    if (keywords.some(k => lower.includes(k))) return intent
  }
  return 'general'
}

// ── Fleet Context Fetcher ─────────────────────────────────────────────────────

interface FleetContext {
  label: string
  data: Record<string, unknown>
}

async function fetchFleetContext(intent: Intent): Promise<FleetContext> {
  const since90 = new Date(); since90.setDate(since90.getDate() - 90)
  const since30 = new Date(); since30.setDate(since30.getDate() - 30)
  const s90 = since90.toISOString().split('T')[0]
  const s30 = since30.toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  switch (intent) {
    case 'fleet_overview': {
      const [recs, vehs, acts, accs] = await Promise.all([
        supabase.from('tyre_records').select('cost_per_tyre,risk_level').gte('issue_date', s90),
        supabase.from('vehicle_fleet').select('id', { count: 'exact', head: true }),
        supabase.from('corrective_actions').select('status', { count: 'exact' }).eq('status', 'Open'),
        supabase.from('accidents').select('id', { count: 'exact', head: true }).gte('incident_date', s30),
      ])
      const records = (recs.data ?? []) as { cost_per_tyre: number | null; risk_level: string | null }[]
      const totalCost = records.reduce((s, r) => s + (Number(r.cost_per_tyre) || 0), 0)
      const riskCounts: Record<string, number> = {}
      records.forEach(r => { const k = r.risk_level ?? 'Unknown'; riskCounts[k] = (riskCounts[k] ?? 0) + 1 })
      return {
        label: `Analyzed ${records.length} tyre records (last 90 days), ${vehs.count ?? 0} vehicles`,
        data: {
          period: 'Last 90 days',
          totalTyreRecords: records.length,
          totalCost: `SAR ${totalCost.toLocaleString()}`,
          avgCostPerTyre: records.length ? `SAR ${Math.round(totalCost / records.length).toLocaleString()}` : 'N/A',
          fleetSize: vehs.count ?? 0,
          openWorkOrders: acts.count ?? 0,
          accidentsLast30Days: accs.count ?? 0,
          riskBreakdown: riskCounts,
        },
      }
    }

    case 'risk_analysis': {
      const res = await supabase.from('tyre_records')
        .select('asset_no,site,risk_level,brand,position,cost_per_tyre,issue_date')
        .in('risk_level', ['Critical', 'High'])
        .order('issue_date', { ascending: false })
        .limit(20)
      const records = res.data ?? []
      const bySite: Record<string, { critical: number; high: number }> = {}
      records.forEach((r: any) => {
        const s = r.site ?? 'Unknown'
        if (!bySite[s]) bySite[s] = { critical: 0, high: 0 }
        if (r.risk_level === 'Critical') bySite[s].critical++
        else bySite[s].high++
      })
      return {
        label: `Found ${records.length} critical/high-risk records`,
        data: {
          totalAtRisk: records.length,
          criticalCount: records.filter((r: any) => r.risk_level === 'Critical').length,
          highCount: records.filter((r: any) => r.risk_level === 'High').length,
          riskBySite: bySite,
          recentCritical: records.filter((r: any) => r.risk_level === 'Critical').slice(0, 5).map((r: any) => ({
            asset: r.asset_no, site: r.site, brand: r.brand, position: r.position, date: r.issue_date,
          })),
        },
      }
    }

    case 'cost_analysis': {
      const res = await supabase.from('tyre_records')
        .select('site,brand,cost_per_tyre,issue_date,risk_level')
        .gte('issue_date', s90)
      const records = (res.data ?? []) as { site: string | null; brand: string | null; cost_per_tyre: number | null; risk_level: string | null }[]
      const bySite: Record<string, { cost: number; count: number }> = {}
      const byBrand: Record<string, { cost: number; count: number }> = {}
      records.forEach(r => {
        const s = r.site ?? 'Unknown'; const b = r.brand ?? 'Unknown'
        if (!bySite[s]) bySite[s] = { cost: 0, count: 0 }
        if (!byBrand[b]) byBrand[b] = { cost: 0, count: 0 }
        bySite[s].cost += Number(r.cost_per_tyre) || 0; bySite[s].count++
        byBrand[b].cost += Number(r.cost_per_tyre) || 0; byBrand[b].count++
      })
      const topSites = Object.entries(bySite).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5)
        .map(([site, v]) => ({ site, totalCost: `SAR ${Math.round(v.cost).toLocaleString()}`, count: v.count }))
      const topBrands = Object.entries(byBrand).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5)
        .map(([brand, v]) => ({ brand, totalCost: `SAR ${Math.round(v.cost).toLocaleString()}`, avgCost: `SAR ${Math.round(v.cost / v.count).toLocaleString()}` }))
      const total = records.reduce((s, r) => s + (Number(r.cost_per_tyre) || 0), 0)
      return {
        label: `Cost data for ${records.length} records (last 90 days)`,
        data: {
          period: 'Last 90 days',
          totalCost: `SAR ${Math.round(total).toLocaleString()}`,
          recordCount: records.length,
          topSitesByCost: topSites,
          topBrandsByCost: topBrands,
        },
      }
    }

    case 'work_orders': {
      const [statusRes, overdueRes] = await Promise.all([
        supabase.from('corrective_actions').select('status'),
        supabase.from('corrective_actions')
          .select('title,asset_no,site,due_date,priority,status')
          .lt('due_date', today)
          .not('status', 'in', '("Closed","Resolved")')
          .order('due_date', { ascending: true })
          .limit(10),
      ])
      const statusRows = (statusRes.data ?? []) as { status: string }[]
      const statusCounts: Record<string, number> = {}
      statusRows.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1 })
      return {
        label: `Checked ${statusRows.length} work orders, found ${overdueRes.data?.length ?? 0} overdue`,
        data: {
          totalWorkOrders: statusRows.length,
          byStatus: statusCounts,
          overdueCount: overdueRes.data?.length ?? 0,
          overdueItems: (overdueRes.data ?? []).slice(0, 5).map((r: any) => ({
            title: r.title, asset: r.asset_no, site: r.site, dueDate: r.due_date, priority: r.priority,
          })),
        },
      }
    }

    case 'tyre_analysis': {
      const res = await supabase.from('tyre_records')
        .select('brand,condition,cost_per_tyre,risk_level')
        .gte('issue_date', s90)
      const records = (res.data ?? []) as { brand: string | null; condition: string | null; cost_per_tyre: number | null; risk_level: string | null }[]
      const byBrand: Record<string, { count: number; cost: number; critical: number }> = {}
      const byCondition: Record<string, number> = {}
      records.forEach(r => {
        const b = r.brand ?? 'Unknown'; const c = r.condition ?? 'Unknown'
        if (!byBrand[b]) byBrand[b] = { count: 0, cost: 0, critical: 0 }
        byBrand[b].count++; byBrand[b].cost += Number(r.cost_per_tyre) || 0
        if (r.risk_level === 'Critical') byBrand[b].critical++
        byCondition[c] = (byCondition[c] ?? 0) + 1
      })
      const brands = Object.entries(byBrand).sort((a, b) => b[1].count - a[1].count).slice(0, 8)
        .map(([brand, v]) => ({
          brand, count: v.count, avgCost: `SAR ${Math.round(v.cost / v.count).toLocaleString()}`,
          criticalRate: `${v.count > 0 ? Math.round((v.critical / v.count) * 100) : 0}%`,
        }))
      return {
        label: `Brand analysis across ${records.length} tyre records (last 90 days)`,
        data: { totalRecords: records.length, brandPerformance: brands, conditionBreakdown: byCondition },
      }
    }

    case 'site_analysis': {
      const res = await supabase.from('tyre_records')
        .select('site,risk_level,cost_per_tyre')
        .gte('issue_date', s90)
      const records = (res.data ?? []) as { site: string | null; risk_level: string | null; cost_per_tyre: number | null }[]
      const bySite: Record<string, { count: number; cost: number; critical: number; high: number }> = {}
      records.forEach(r => {
        const s = r.site ?? 'Unknown'
        if (!bySite[s]) bySite[s] = { count: 0, cost: 0, critical: 0, high: 0 }
        bySite[s].count++; bySite[s].cost += Number(r.cost_per_tyre) || 0
        if (r.risk_level === 'Critical') bySite[s].critical++
        if (r.risk_level === 'High') bySite[s].high++
      })
      const sites = Object.entries(bySite).sort((a, b) => b[1].critical - a[1].critical).map(([site, v]) => ({
        site, count: v.count, totalCost: `SAR ${Math.round(v.cost).toLocaleString()}`,
        critical: v.critical, high: v.high,
        riskScore: v.count > 0 ? Math.round(((v.critical * 3 + v.high * 2) / v.count) * 100) : 0,
      }))
      return {
        label: `Site analysis across ${Object.keys(bySite).length} sites (last 90 days)`,
        data: { totalSites: Object.keys(bySite).length, siteRiskMatrix: sites },
      }
    }

    case 'vehicle_query': {
      const [vehs, byType] = await Promise.all([
        supabase.from('vehicle_fleet').select('id,asset_type,site', { count: 'exact' }),
        supabase.from('vehicle_fleet').select('asset_type'),
      ])
      const typeCounts: Record<string, number> = {}
      ;(byType.data ?? []).forEach((r: any) => {
        const t = r.asset_type ?? 'Unknown'; typeCounts[t] = (typeCounts[t] ?? 0) + 1
      })
      return {
        label: `Fleet registry: ${vehs.count ?? 0} vehicles`,
        data: { totalVehicles: vehs.count ?? 0, byType: typeCounts },
      }
    }

    default: {
      const [recs, acts] = await Promise.all([
        supabase.from('tyre_records').select('id', { count: 'exact', head: true }).gte('issue_date', s90),
        supabase.from('corrective_actions').select('id', { count: 'exact', head: true }).eq('status', 'Open'),
      ])
      return {
        label: 'General fleet context loaded',
        data: { tyreRecordsLast90Days: recs.count ?? 0, openWorkOrders: acts.count ?? 0 },
      }
    }
  }
}

// ── System Prompt Builder ─────────────────────────────────────────────────────

function buildSystemPrompt(context: FleetContext): string {
  return `You are the Tyre Pulse AI Command Center - a fleet intelligence engine for senior fleet managers and administrators.

You analyze real-time fleet data and provide sharp, actionable insights. You are NOT a generic chatbot.

Live Fleet Data (just fetched):
${JSON.stringify(context.data, null, 2)}

Your response style:
- Be direct and concise. Lead with the most critical finding.
- Use numbers, percentages and cost figures from the data above.
- Highlight anomalies and risks clearly.
- End every response with 2-3 specific, prioritized recommendations.
- Format with short paragraphs - no long walls of text.
- If a question is outside fleet/tyre scope, redirect politely.

At the very end of your response (and ONLY if relevant), add one line in this exact format:
ACTIONS: action1,action2
Where actions are from: view_critical, view_workorders, view_analytics, view_reports, view_records
Only include ACTIONS if there is a clear next step the user should take in the app.`
}

// ── Parse Actions from AI response ───────────────────────────────────────────

function parseActions(content: string): { text: string; actions: ActionTag[] } {
  const match = content.match(/\nACTIONS:\s*([^\n]+)$/m)
  if (!match) return { text: content.trim(), actions: [] }
  const validActions: ActionTag[] = ['view_critical', 'view_workorders', 'view_analytics', 'view_reports', 'view_records']
  const actions = match[1].split(',').map(a => a.trim() as ActionTag).filter(a => validActions.includes(a))
  return { text: content.replace(match[0], '').trim(), actions }
}

function actionLabel(action: ActionTag): string {
  switch (action) {
    case 'view_critical':   return 'View Critical Tyres'
    case 'view_workorders': return 'View Work Orders'
    case 'view_analytics':  return 'Open Analytics'
    case 'view_reports':    return 'Generate Report'
    case 'view_records':    return 'Browse Records'
  }
}

function handleAction(action: ActionTag) {
  switch (action) {
    case 'view_critical':   router.push('/(app)/records/index')   ; break
    case 'view_workorders': router.push('/(app)/workorders/index'); break
    case 'view_analytics':  router.push('/(app)/analytics/index') ; break
    case 'view_reports':    router.push('/(app)/reports/index')   ; break
    case 'view_records':    router.push('/(app)/records/index')   ; break
  }
}

// ── Quick Commands ────────────────────────────────────────────────────────────

const QUICK_COMMANDS = [
  { icon: 'pulse-outline',         label: 'Fleet health overview',   query: 'Give me a complete fleet health overview and key KPIs' },
  { icon: 'warning-outline',       label: 'Critical tyres now',      query: 'Show me the critical and high-risk tyres right now with site breakdown' },
  { icon: 'cash-outline',          label: 'Cost breakdown',          query: 'Break down fleet tyre costs by site and brand for the last 90 days' },
  { icon: 'construct-outline',     label: 'Overdue work orders',     query: 'What work orders are overdue and what is the current status of corrective actions?' },
  { icon: 'analytics-outline',     label: 'Brand performance',       query: 'Compare tyre brand performance - failure rates, average cost and reliability' },
  { icon: 'location-outline',      label: 'Site risk analysis',      query: 'Which sites have the highest risk concentration and what should be done?' },
]

// ── Typing Dots Animation ─────────────────────────────────────────────────────

function TypingDots() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current]
  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
          Animated.delay(480 - i * 160),
        ])
      )
    )
    Animated.parallel(anims).start()
    return () => anims.forEach(a => a.stop())
  }, [])
  return (
    <View style={ds.typingBubble}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={[ds.dot, { opacity: dot, transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] }]} />
      ))}
    </View>
  )
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function AICommandCenter() {
  const { profile } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [contextLabel, setContextLabel] = useState('')
  const listRef = useRef<FlatList>(null)

  const role = profile?.role ?? null
  if (!canUseAI(role)) {
    return (
      <SafeAreaView style={ds.safe}>
        <View style={ds.center}>
          <Ionicons name="lock-closed-outline" size={48} color="#94a3b8" />
          <Text style={ds.accessDenied}>AI Command Center is available{'\n'}for Admin, Manager & Director</Text>
        </View>
      </SafeAreaView>
    )
  }

  const send = useCallback(async (text?: string) => {
    const query = (text ?? input).trim()
    if (!query || thinking) return
    setInput('')

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: query, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setThinking(true)

    try {
      const intent = classifyIntent(query)
      const context = await fetchFleetContext(intent)
      setContextLabel(context.label)

      const history = [...messages, userMsg].slice(-8).map(m => ({ role: m.role, content: m.content }))
      const systemPrompt = buildSystemPrompt(context)

      const { data, error } = await supabase.functions.invoke('chat-ai', {
        body: { system: systemPrompt, messages: history, max_tokens: 1200 },
      })

      if (error || !data?.content) throw new Error(error?.message ?? 'No response')

      const { text: responseText, actions } = parseActions(data.content as string)

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText,
        actions,
        timestamp: new Date(),
        dataLabel: context.label,
      }
      setMessages(prev => [...prev, aiMsg])
    } catch (err) {
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I encountered an error fetching fleet data. Please check your connection and try again.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, aiMsg])
    } finally {
      setThinking(false)
      setContextLabel('')
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }, [input, messages, thinking])

  function clearChat() { setMessages([]) }

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.role === 'user') {
      return (
        <View style={ds.userRow}>
          <View style={ds.userBubble}>
            <Text style={ds.userText}>{item.content}</Text>
          </View>
        </View>
      )
    }
    return (
      <View style={ds.aiBubble}>
        <View style={ds.aiHeader}>
          <View style={ds.aiAvatar}><Ionicons name="sparkles" size={12} color="#fff" /></View>
          <Text style={ds.aiName}>Fleet AI</Text>
          {item.dataLabel && <Text style={ds.dataLabel} numberOfLines={1}>{item.dataLabel}</Text>}
        </View>
        <Text style={ds.aiText}>{item.content}</Text>
        {item.actions && item.actions.length > 0 && (
          <View style={ds.actionRow}>
            {item.actions.map(a => (
              <Pressable key={a} style={ds.actionBtn} onPress={() => handleAction(a)}>
                <Text style={ds.actionBtnText}>{actionLabel(a)}</Text>
                <Ionicons name="arrow-forward" size={12} color="#7c3aed" />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    )
  }

  const isEmpty = messages.length === 0

  return (
    <SafeAreaView style={ds.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#faf5ff" />

      {/* Header */}
      <View style={ds.header}>
        <View style={ds.headerLeft}>
          <View style={ds.aiIconBg}><Ionicons name="sparkles" size={18} color="#fff" /></View>
          <View>
            <Text style={ds.title}>AI Command Center</Text>
            <Text style={ds.subtitle}>Agentic fleet intelligence · {profile?.site ?? 'All sites'}</Text>
          </View>
        </View>
        {!isEmpty && (
          <TouchableOpacity onPress={clearChat} style={ds.clearBtn}>
            <Ionicons name="refresh-outline" size={18} color="#7c3aed" />
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>

        {isEmpty ? (
          <ScrollView contentContainerStyle={ds.welcomeContent} keyboardShouldPersistTaps="handled">
            {/* Welcome card */}
            <View style={ds.welcomeCard}>
              <View style={ds.welcomeIconRing}><Ionicons name="sparkles" size={32} color="#7c3aed" /></View>
              <Text style={ds.welcomeTitle}>Fleet AI Command Center</Text>
              <Text style={ds.welcomeSubtitle}>
                Ask anything about your fleet. I fetch live data from your database and deliver actionable intelligence - costs, risks, work orders, brand performance and more.
              </Text>
            </View>

            {/* Capability chips */}
            <View style={ds.capRow}>
              {[
                { icon: 'pulse-outline', label: 'Live KPIs' },
                { icon: 'analytics-outline', label: 'Cost Analysis' },
                { icon: 'warning-outline', label: 'Risk Alerts' },
                { icon: 'construct-outline', label: 'Work Orders' },
              ].map(c => (
                <View key={c.label} style={ds.capChip}>
                  <Ionicons name={c.icon as any} size={14} color="#7c3aed" />
                  <Text style={ds.capLabel}>{c.label}</Text>
                </View>
              ))}
            </View>

            {/* Quick commands */}
            <Text style={ds.sectionLabel}>Quick Commands</Text>
            <View style={ds.quickGrid}>
              {QUICK_COMMANDS.map(cmd => (
                <TouchableOpacity key={cmd.label} style={ds.quickCard} onPress={() => send(cmd.query)}>
                  <Ionicons name={cmd.icon as any} size={20} color="#7c3aed" />
                  <Text style={ds.quickLabel}>{cmd.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            renderItem={renderMessage}
            contentContainerStyle={ds.list}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
            ListFooterComponent={
              thinking ? (
                <View style={ds.thinkingRow}>
                  <View style={ds.aiAvatar}><Ionicons name="sparkles" size={12} color="#fff" /></View>
                  <View>
                    <TypingDots />
                    {contextLabel ? <Text style={ds.fetchingLabel}>{contextLabel}…</Text> : null}
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {/* Input bar */}
        <View style={ds.inputBar}>
          {!isEmpty && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ds.miniCmds} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
              {QUICK_COMMANDS.slice(0, 4).map(cmd => (
                <TouchableOpacity key={cmd.label} style={ds.miniChip} onPress={() => send(cmd.query)}>
                  <Text style={ds.miniChipText}>{cmd.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <View style={ds.inputRow}>
            <TextInput
              style={ds.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask about fleet costs, risks, tyres…"
              placeholderTextColor="#94a3b8"
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={() => send()}
              editable={!thinking}
            />
            <TouchableOpacity
              style={[ds.sendBtn, (!input.trim() || thinking) && ds.sendBtnDisabled]}
              onPress={() => send()}
              disabled={!input.trim() || thinking}
            >
              {thinking
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="send" size={18} color="#fff" />
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ds = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#faf5ff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  accessDenied: { fontSize: 15, color: '#94a3b8', textAlign: 'center', marginTop: 12, lineHeight: 22 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiIconBg:   { width: 36, height: 36, borderRadius: 10, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center' },
  title:      { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  subtitle:   { fontSize: 11, color: '#64748b', marginTop: 1 },
  clearBtn:   { padding: 8 },

  // Welcome
  welcomeContent: { padding: 20, gap: 20 },
  welcomeCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', gap: 12,
    shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 16, elevation: 4,
  },
  welcomeIconRing: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#f3e8ff',
    alignItems: 'center', justifyContent: 'center',
  },
  welcomeTitle:    { fontSize: 18, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  welcomeSubtitle: { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 20 },

  capRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  capChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ede9fe', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  capLabel:{ fontSize: 12, fontWeight: '600', color: '#5b21b6' },

  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: -4 },
  quickGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickCard: {
    width: '48%', backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 8,
    borderWidth: 1.5, borderColor: '#e9d5ff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  quickLabel: { fontSize: 12, fontWeight: '600', color: '#374151', lineHeight: 17 },

  // Messages
  list: { padding: 16, gap: 16, paddingBottom: 8 },

  userRow:  { alignItems: 'flex-end' },
  userBubble: { backgroundColor: '#7c3aed', borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '80%' },
  userText:   { color: '#fff', fontSize: 14, lineHeight: 20 },

  aiBubble: {
    backgroundColor: '#fff', borderRadius: 18, borderBottomLeftRadius: 4, padding: 14, maxWidth: '92%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  aiHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  aiAvatar:  { width: 22, height: 22, borderRadius: 11, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center' },
  aiName:    { fontSize: 12, fontWeight: '700', color: '#7c3aed' },
  dataLabel: { fontSize: 10, color: '#94a3b8', flex: 1 },
  aiText:    { fontSize: 13.5, color: '#1e293b', lineHeight: 21 },

  actionRow: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#f3e8ff', paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: '#e9d5ff',
  },
  actionBtnText: { fontSize: 12, fontWeight: '700', color: '#7c3aed' },

  // Thinking
  thinkingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  typingBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#7c3aed' },
  fetchingLabel: { fontSize: 10, color: '#94a3b8', marginTop: 4, marginLeft: 4 },

  // Input bar
  inputBar:  { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)', paddingBottom: Platform.OS === 'ios' ? 8 : 4 },
  miniCmds:  { paddingVertical: 8 },
  miniChip: {
    backgroundColor: '#f3e8ff', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#e9d5ff',
  },
  miniChipText: { fontSize: 11, fontWeight: '600', color: '#7c3aed' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 4 },
  input: {
    flex: 1, backgroundColor: '#f8fafc', borderRadius: 22, borderWidth: 1.5, borderColor: '#e2e8f0',
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: '#0f172a',
    maxHeight: 100, lineHeight: 20,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#7c3aed',
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#c4b5fd' },
})
