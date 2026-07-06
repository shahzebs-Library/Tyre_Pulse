// ─────────────────────────────────────────────────────────────────────────────
// AiCommandCenter.jsx - Multi-agent AI interface for TyrePulse AI OS
// Route: /ai-command-center
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Send, Trash2, Copy, Check, Download, RefreshCw,
  ChevronDown, ChevronUp, AlertTriangle, Activity, BarChart2,
  ClipboardList, Cpu, Zap, Filter, X, User, Bot, Sparkles,
  TrendingUp, TrendingDown, Minus, Clock, Database,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { supabase } from '../lib/supabase'
import { classifyQuery, AGENT_TYPES, AGENT_LABELS, AGENT_COLORS, AGENT_DESCRIPTIONS } from '../lib/aiRouter'
import { runAnalystAgent } from '../lib/agents/analystAgent'
import { runTyreEngineerAgent } from '../lib/agents/tyreEngineerAgent'
import { runQaDataAgent } from '../lib/agents/qaDataAgent'
import { runPlannerAgent } from '../lib/agents/plannerAgent'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState } from '../lib/exportUtils'

// ── Constants ─────────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Analyse fleet CPK',           query: 'Analyse the overall fleet CPK trend. Which sites and brands are performing worst and what is the financial impact?', agent: AGENT_TYPES.ANALYST },
  { label: 'Diagnose worst vehicle',       query: 'Which vehicle has the highest CPK in the fleet? Diagnose the root cause of its poor tyre performance.', agent: AGENT_TYPES.TYRE_ENGINEER },
  { label: 'Plan next month replacements', query: 'How many tyre replacements should I plan for next month? Provide a budget estimate and priority schedule.', agent: AGENT_TYPES.PLANNER },
  { label: 'Check data quality',           query: 'Run a full data quality check on the fleet records. Identify all issues and prioritise fixes.', agent: AGENT_TYPES.QA_DATA },
  { label: 'Root cause high failures',     query: 'What are the root causes of the highest failure rates in the fleet? Investigate pressure, alignment, and driver behaviour factors.', agent: AGENT_TYPES.TYRE_ENGINEER },
  { label: 'Cost trend analysis',          query: 'Analyse the monthly cost trend for the last 6 months. Is the fleet getting more or less expensive to maintain?', agent: AGENT_TYPES.ANALYST },
  { label: 'Procurement plan Q3',          query: 'Build a procurement plan for the next quarter. Which brands should I order, in what quantities, and from which sites?', agent: AGENT_TYPES.PLANNER },
  { label: 'Brand performance ranking',    query: 'Rank all tyre brands by CPK, failure rate, and average life. Which brand offers the best value?', agent: AGENT_TYPES.ANALYST },
]

const AGENT_ICONS = {
  [AGENT_TYPES.ANALYST]:       BarChart2,
  [AGENT_TYPES.TYRE_ENGINEER]: Cpu,
  [AGENT_TYPES.QA_DATA]:       Database,
  [AGENT_TYPES.PLANNER]:       ClipboardList,
}

const TREND_ICON = (trend) => {
  if (trend === 'worsening')  return <TrendingUp className="w-3.5 h-3.5 text-red-400" />
  if (trend === 'improving')  return <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
  return <Minus className="w-3.5 h-3.5 text-[var(--text-muted)]" />
}

// ── Helper: format response text with markdown-like rendering ─────────────────

function FormattedResponse({ text }) {
  if (!text) return null

  const lines = text.split('\n')
  const elements = []
  let key = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('## ') || line.startsWith('# ')) {
      const content = line.replace(/^#+ /, '')
      elements.push(
        <h3 key={key++} className="text-sm font-semibold text-[var(--text-primary)] mt-4 mb-1.5 first:mt-0">
          {content}
        </h3>
      )
    } else if (/^\d+\.\s/.test(line)) {
      const content = line.replace(/^\d+\.\s/, '')
      const num = line.match(/^(\d+)/)[1]
      elements.push(
        <div key={key++} className="flex gap-2 my-1">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--input-bg)] text-[var(--text-secondary)] text-xs flex items-center justify-center font-medium">
            {num}
          </span>
          <span className="text-[var(--text-secondary)] text-sm leading-relaxed flex-1"
            dangerouslySetInnerHTML={{ __html: renderInline(content) }}
          />
        </div>
      )
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const content = line.replace(/^[-*]\s/, '')
      elements.push(
        <div key={key++} className="flex gap-2 my-0.5 ml-1">
          <span className="flex-shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-[var(--text-secondary)] text-sm leading-relaxed flex-1"
            dangerouslySetInnerHTML={{ __html: renderInline(content) }}
          />
        </div>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={key++} className="h-1.5" />)
    } else {
      elements.push(
        <p key={key++} className="text-[var(--text-secondary)] text-sm leading-relaxed my-0.5"
          dangerouslySetInnerHTML={{ __html: renderInline(line) }}
        />
      )
    }
  }

  return <div className="space-y-0.5">{elements}</div>
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderInline(text) {
  // Escape all HTML first - prevents XSS from AI-generated content
  const safe = escapeHtml(text)
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-[var(--text-primary)] font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-[var(--text-secondary)]">$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-[var(--input-bg)] text-emerald-300 px-1 py-0.5 rounded text-xs font-mono">$1</code>')
}

// ── KPI Summary Panel (shown for Analyst responses) ──────────────────────────

function KpiPanel({ kpis, costTrend, vendorRank }) {
  if (!kpis) return null

  const cpk = kpis.cpk
  const avgLife = kpis.avgTyreLife
  const failure = kpis.failureRate
  const compliance = kpis.inspectionCompliance

  const metrics = [
    { label: 'Fleet CPK', value: cpk?.fleetAvgCpk?.toFixed(3) ?? 'N/A', sub: `${cpk?.validCount ?? 0} valid records` },
    { label: 'Avg Life', value: avgLife?.avgKm ? `${(avgLife.avgKm / 1000).toFixed(0)}k km` : 'N/A', sub: `median ${avgLife?.medianKm ? `${(avgLife.medianKm / 1000).toFixed(0)}k` : 'N/A'} km` },
    { label: 'Failure Rate', value: failure?.failureRate != null ? `${(failure.failureRate * 100).toFixed(1)}%` : 'N/A', sub: `${failure?.failureCount ?? 0} failures` },
    { label: 'Inspection', value: compliance?.compliancePct != null ? `${compliance.compliancePct.toFixed(1)}%` : 'N/A', sub: 'compliance' },
    { label: 'Cost Trend', value: costTrend?.trend ?? 'N/A', sub: `slope: ${costTrend?.slope?.toFixed(0) ?? 'N/A'}`, icon: TREND_ICON(costTrend?.trend) },
  ]

  return (
    <div className="mt-3 pt-3 border-t border-[var(--input-border)]/50">
      <p className="text-xs text-[var(--text-muted)] mb-2 uppercase tracking-wider font-medium">KPI Snapshot</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {metrics.map(m => (
          <div key={m.label} className="bg-[var(--input-bg)]/60 rounded-lg p-2.5">
            <p className="text-xs text-[var(--text-muted)] mb-0.5">{m.label}</p>
            <div className="flex items-center gap-1">
              {m.icon}
              <span className="text-sm font-semibold text-[var(--text-primary)] capitalize">{m.value}</span>
            </div>
            <p className="text-xs text-[var(--text-dim)] mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      {vendorRank?.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-[var(--text-muted)] mb-1.5">Brand Ranking (best CPK first)</p>
          <div className="flex flex-wrap gap-1.5">
            {vendorRank.map((b, i) => (
              <span key={b.brand} className={`text-xs px-2 py-1 rounded-full font-medium ${i === 0 ? 'bg-emerald-900/40 text-emerald-300' : i === vendorRank.length - 1 ? 'bg-red-900/40 text-red-300' : 'bg-[var(--input-bg)]/60 text-[var(--text-secondary)]'}`}>
                #{i + 1} {b.brand} ({b.avgCpk?.toFixed(3)})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── QA Summary Panel ──────────────────────────────────────────────────────────

function QaPanel({ checks, dataQualityScore, totalIssues }) {
  if (!checks) return null

  const score = Number(dataQualityScore)
  const scoreColor = score >= 90 ? 'text-emerald-400' : score >= 70 ? 'text-amber-400' : 'text-red-400'

  const issueItems = [
    { label: 'Invalid odometer', count: checks.invalidOdometer?.count ?? 0 },
    { label: 'Unrealistic life', count: checks.unrealisticLife?.count ?? 0 },
    { label: 'Missing cost',     count: checks.missingCost?.count ?? 0 },
    { label: 'Duplicate serials',count: checks.duplicateSerials?.count ?? 0 },
    { label: 'Missing date',     count: checks.missingFitmentDate?.count ?? 0 },
    { label: 'Missing asset',    count: checks.missingAsset?.count ?? 0 },
    { label: 'Missing brand',    count: checks.missingBrand?.count ?? 0 },
    { label: 'Invalid risk lvl', count: checks.invalidRiskLevel?.count ?? 0 },
  ].filter(i => i.count > 0)

  return (
    <div className="mt-3 pt-3 border-t border-[var(--input-border)]/50">
      <div className="flex items-center gap-3 mb-2">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">Data Quality Score</p>
        <span className={`text-lg font-bold ${scoreColor}`}>{dataQualityScore}%</span>
        <span className="text-xs text-[var(--text-muted)]">({totalIssues} issues in {checks.totalRecords} records)</span>
      </div>
      {issueItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {issueItems.map(item => (
            <span key={item.label} className="text-xs bg-red-900/30 text-red-300 border border-red-800/40 px-2 py-1 rounded-full">
              {item.label}: {item.count}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Planning Panel ────────────────────────────────────────────────────────────

function PlannerPanel({ planningData }) {
  if (!planningData) return null
  const { forecasts, annualForecast, replacementRate, avgLife } = planningData

  return (
    <div className="mt-3 pt-3 border-t border-[var(--input-border)]/50">
      <p className="text-xs text-[var(--text-muted)] mb-2 uppercase tracking-wider font-medium">Planning Forecast</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-[var(--input-bg)]/60 rounded-lg p-2.5">
          <p className="text-xs text-[var(--text-muted)] mb-0.5">Avg Replacements/Vehicle/Month</p>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{replacementRate?.avgPerVehiclePerMonth?.toFixed(2) ?? 'N/A'}</p>
        </div>
        <div className="bg-[var(--input-bg)]/60 rounded-lg p-2.5">
          <p className="text-xs text-[var(--text-muted)] mb-0.5">Avg Tyre Life</p>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{avgLife?.avgKm ? `${(avgLife.avgKm / 1000).toFixed(0)}k km` : 'N/A'}</p>
        </div>
        <div className="bg-[var(--input-bg)]/60 rounded-lg p-2.5">
          <p className="text-xs text-[var(--text-muted)] mb-0.5">Active Vehicles</p>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{replacementRate?.activeVehicles ?? 'N/A'}</p>
        </div>
        <div className="bg-[var(--input-bg)]/60 rounded-lg p-2.5">
          <p className="text-xs text-[var(--text-muted)] mb-0.5">Annual Budget Est.</p>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{annualForecast ? annualForecast.toFixed(0) : 'N/A'}</p>
        </div>
      </div>
      {forecasts?.length > 0 && (
        <div className="mt-2 flex gap-2">
          {forecasts.map(f => (
            <div key={f.month} className="flex-1 bg-[var(--input-bg)]/40 rounded-lg p-2 text-center">
              <p className="text-xs text-[var(--text-muted)]">{f.month}</p>
              <p className="text-sm font-semibold text-emerald-400">{f.forecastCost?.toFixed(0) ?? 'N/A'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message, onCopy }) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  const agentColor = message.agentType ? AGENT_COLORS[message.agentType] : null
  const AgentIcon  = message.agentType ? AGENT_ICONS[message.agentType] : Bot

  function handleCopy() {
    navigator.clipboard.writeText(message.content ?? message.response ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-end"
      >
        <div className="max-w-2xl">
          <div className="bg-blue-600/20 border border-blue-600/30 rounded-2xl rounded-tr-sm px-4 py-3">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{message.content}</p>
          </div>
          <p className="text-xs text-[var(--text-dim)] text-right mt-1 pr-1">{message.timestamp}</p>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3"
    >
      {/* Agent avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1 ${agentColor?.bg ?? 'bg-[var(--input-bg)]'} border ${agentColor?.border ?? 'border-[var(--input-border)]'}`}>
        <AgentIcon className={`w-4 h-4 ${agentColor?.text ?? 'text-[var(--text-muted)]'}`} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Agent badge */}
        {message.agentType && (
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${agentColor?.bg} ${agentColor?.text} ${agentColor?.border}`}>
              {AGENT_LABELS[message.agentType]} Agent
            </span>
            {message.timestamp && (
              <span className="text-xs text-[var(--text-dim)] flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {message.timestamp}
              </span>
            )}
          </div>
        )}

        {/* Response content */}
        <div className="bg-[var(--input-bg)]/60 border border-[var(--input-border)]/50 rounded-2xl rounded-tl-sm px-4 py-3">
          {expanded ? (
            <FormattedResponse text={message.content ?? message.response} />
          ) : (
            <p className="text-[var(--text-muted)] text-sm italic">Response collapsed</p>
          )}

          {/* Agent-specific data panels */}
          {expanded && message.agentType === AGENT_TYPES.ANALYST && message.kpis && (
            <KpiPanel kpis={message.kpis} costTrend={message.costTrend} vendorRank={message.vendorRank} />
          )}
          {expanded && message.agentType === AGENT_TYPES.QA_DATA && message.checks && (
            <QaPanel checks={message.checks} dataQualityScore={message.dataQualityScore} totalIssues={message.totalIssues} />
          )}
          {expanded && message.agentType === AGENT_TYPES.PLANNER && message.planningData && (
            <PlannerPanel planningData={message.planningData} />
          )}
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 mt-1.5 pl-1">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ── Typing Indicator ──────────────────────────────────────────────────────────

function TypingIndicator({ agentType }) {
  const AgentIcon = AGENT_ICONS[agentType] ?? Bot
  const agentColor = AGENT_COLORS[agentType] ?? {}

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex gap-3"
    >
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${agentColor.bg ?? 'bg-[var(--input-bg)]'} border ${agentColor.border ?? 'border-[var(--input-border)]'}`}>
        <AgentIcon className={`w-4 h-4 ${agentColor.text ?? 'text-[var(--text-muted)]'}`} />
      </div>
      <div className="bg-[var(--input-bg)]/60 border border-[var(--input-border)]/50 rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="flex items-center gap-1">
          <span className={`text-xs font-medium ${agentColor.text ?? 'text-[var(--text-muted)]'}`}>
            {AGENT_LABELS[agentType] ?? 'AI'} Agent is thinking
          </span>
          <div className="flex gap-1 ml-2">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 bg-[var(--text-muted)] rounded-full"
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── Main Page Component ───────────────────────────────────────────────────────

export default function AiCommandCenter() {
  const { site: contextSite, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [messages, setMessages]           = useState([])
  const [query, setQuery]                 = useState('')
  const [loading, setLoading]             = useState(false)
  const [activeAgent, setActiveAgent]     = useState(null)
  const [records, setRecords]             = useState([])
  const [inspections, setInspections]     = useState([])
  const [actions, setActions]             = useState([])
  const [assets, setAssets]               = useState([])
  const [selectedAsset, setSelectedAsset] = useState('')
  const [selectedSite, setSelectedSite]   = useState('')
  const [sites, setSites]                 = useState([])
  const [dataLoading, setDataLoading]     = useState(true)
  const [showFilters, setShowFilters]     = useState(false)
  const [previewAgent, setPreviewAgent]   = useState(null)

  const chatEndRef   = useRef(null)
  const inputRef     = useRef(null)
  const abortRef     = useRef(false)

  // ── Load initial context data ───────────────────────────────────────────────

  useEffect(() => {
    loadContextData()
  }, [contextSite])

  async function loadContextData() {
    setDataLoading(true)
    try {
      const cutoff = new Date()
      cutoff.setMonth(cutoff.getMonth() - 3)
      const cutoffStr = cutoff.toISOString().split('T')[0]

      const [recordsRes, inspRes, actionsRes, assetsRes] = await Promise.all([
        supabase
          .from('tyre_changes')
          .select('asset_no, tyre_serial, brand, position, km_at_fitment, km_at_removal, cost_per_tyre, issue_date, removal_date, risk_level, category, site, removal_reason, qty')
          .gte('issue_date', cutoffStr)
          .order('issue_date', { ascending: false })
          .limit(500),

        supabase
          .from('inspections')
          .select('asset_no, scheduled_date, completed_date, status, findings, site, inspector')
          .gte('scheduled_date', cutoffStr)
          .order('scheduled_date', { ascending: false })
          .limit(200),

        supabase
          .from('corrective_actions')
          .select('asset_no, description, status, priority, site, created_at, closed_at')
          .order('created_at', { ascending: false })
          .limit(100),

        supabase
          .from('fleet_master')
          .select('asset_no, vehicle_type, site')
          .order('asset_no')
          .limit(500),
      ])

      const recs = recordsRes.data ?? []
      const insp = inspRes.data ?? []
      const acts = actionsRes.data ?? []
      const assetList = assetsRes.data ?? []

      setRecords(recs)
      setInspections(insp)
      setActions(acts)
      setAssets(assetList)

      const uniqueSites = [...new Set([...recs.map(r => r.site), ...assetList.map(a => a.site)].filter(Boolean))].sort()
      setSites(uniqueSites)
    } catch (err) {
      console.error('Failed to load AI context data:', err)
    } finally {
      setDataLoading(false)
    }
  }

  // ── Auto-scroll ─────────────────────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // ── Preview agent type as user types ───────────────────────────────────────

  useEffect(() => {
    if (query.trim().length > 3) {
      setPreviewAgent(classifyQuery(query))
    } else {
      setPreviewAgent(null)
    }
  }, [query])

  // ── Context for agents ──────────────────────────────────────────────────────

  const agentContext = useMemo(() => {
    const filteredRecords = selectedSite
      ? records.filter(r => r.site === selectedSite)
      : records
    const filteredInspections = selectedSite
      ? inspections.filter(i => i.site === selectedSite)
      : inspections
    return {
      records: filteredRecords,
      inspections: filteredInspections,
      actions,
      assetNo: selectedAsset || null,
      site: selectedSite || null,
    }
  }, [records, inspections, actions, selectedAsset, selectedSite])

  // ── Send message ─────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (queryText = query) => {
    const text = queryText.trim()
    if (!text || loading) return

    abortRef.current = false
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const agentType = classifyQuery(text)

    const userMsg = { id: Date.now(), role: 'user', content: text, timestamp }
    setMessages(prev => [...prev, userMsg])
    setQuery('')
    setLoading(true)
    setActiveAgent(agentType)
    inputRef.current?.focus()

    try {
      let result

      switch (agentType) {
        case AGENT_TYPES.TYRE_ENGINEER:
          result = await runTyreEngineerAgent(text, agentContext)
          break
        case AGENT_TYPES.QA_DATA:
          result = await runQaDataAgent(text, agentContext)
          break
        case AGENT_TYPES.PLANNER:
          result = await runPlannerAgent(text, agentContext)
          break
        default:
          result = await runAnalystAgent(text, agentContext)
      }

      if (abortRef.current) return

      const aiMsg = {
        id:          Date.now() + 1,
        role:        'assistant',
        content:     result.response,
        agentType:   result.agentType ?? agentType,
        timestamp:   new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        // Agent-specific data for panels
        kpis:         result.kpis,
        costTrend:    result.costTrend,
        vendorRank:   result.vendorRank,
        checks:       result.checks,
        dataQualityScore: result.dataQualityScore,
        totalIssues:  result.totalIssues,
        planningData: result.planningData,
        vehicleData:  result.vehicleData,
      }

      setMessages(prev => [...prev, aiMsg])
    } catch (err) {
      console.error('Agent error:', err)
      if (!abortRef.current) {
        setMessages(prev => [...prev, {
          id:        Date.now() + 1,
          role:      'assistant',
          content:   'An error occurred while processing your query. Please check your connection and try again.',
          agentType,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }])
      }
    } finally {
      if (!abortRef.current) {
        setLoading(false)
        setActiveAgent(null)
      }
    }
  }, [query, loading, agentContext])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function clearChat() {
    abortRef.current = true
    setMessages([])
    setLoading(false)
    setActiveAgent(null)
  }

  // ── Export chat as PDF ──────────────────────────────────────────────────────

  async function exportChatPdf() {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 15
    const maxWidth = pageWidth - margin * 2
    const brand = await resolvePdfBrand(branding)

    pdfHeader(doc, 'AI Command Center - Chat Export', `${records.length} records loaded`, company, brand)

    // ── Empty state: nothing to export ──
    if (messages.length === 0) {
      pdfEmptyState(doc, 'No conversation to export')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(`tyre-pulse-ai-chat-${new Date().toISOString().slice(0, 10)}.pdf`)
      return
    }

    let y = 30

    messages.forEach(msg => {
      if (y > 260) { doc.addPage(); y = 20 }

      const isUser = msg.role === 'user'
      doc.setFontSize(8)
      doc.setTextColor(isUser ? 37 : 110, isUser ? 99 : 110, isUser ? 235 : 110)
      doc.text(isUser ? `You - ${msg.timestamp}` : `${AGENT_LABELS[msg.agentType] ?? 'AI'} Agent - ${msg.timestamp}`, margin, y)
      y += 4

      doc.setFontSize(9)
      doc.setTextColor(40, 40, 40)
      const content = msg.content ?? msg.response ?? ''
      const lines = doc.splitTextToSize(content.replace(/\*\*/g, '').replace(/\*/g, '').replace(/## /g, '').replace(/# /g, ''), maxWidth)
      lines.forEach(line => {
        if (y > 270) { doc.addPage(); y = 20 }
        doc.text(line, margin, y)
        y += 4.5
      })
      y += 4
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save(`tyre-pulse-ai-chat-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const filteredAssets = useMemo(() => {
    const base = selectedSite ? assets.filter(a => a.site === selectedSite) : assets
    return base.slice(0, 200)
  }, [assets, selectedSite])

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Command Center"
        subtitle="Multi-agent fleet intelligence - Analyst · Engineer · QA · Planner"
        icon={Brain}
        actions={
          <div className="flex items-center gap-2 flex-shrink-0">
            {dataLoading ? (
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Loading context...
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {records.length} records loaded
              </span>
            )}

            <button
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${showFilters ? 'bg-blue-600/20 border-blue-600/40 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'}`}
            >
              <Filter className="w-3.5 h-3.5" />
              Context
            </button>

            {messages.length > 0 && (
              <>
                <button
                  onClick={exportChatPdf}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export PDF
                </button>
                <button
                  onClick={clearChat}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear
                </button>
              </>
            )}
          </div>
        }
      />

      {/* Context filter panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5 font-medium">Site Filter</label>
                  <select
                    value={selectedSite}
                    onChange={e => { setSelectedSite(e.target.value); setSelectedAsset('') }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">All sites ({records.length} records)</option>
                    {sites.map(s => (
                      <option key={s} value={s}>{s} ({records.filter(r => r.site === s).length} records)</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5 font-medium">Vehicle Context (optional)</label>
                  <select
                    value={selectedAsset}
                    onChange={e => setSelectedAsset(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">No specific vehicle</option>
                    {filteredAssets.map(a => (
                      <option key={a.asset_no} value={a.asset_no}>{a.asset_no}{a.vehicle_type ? ` - ${a.vehicle_type}` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>
              {(selectedAsset || selectedSite) && (
                <div className="flex items-center gap-2 mt-2">
                  {selectedSite && (
                    <span className="flex items-center gap-1 text-xs bg-blue-900/30 text-blue-300 border border-blue-800/40 px-2 py-1 rounded-full">
                      Site: {selectedSite}
                      <button onClick={() => setSelectedSite('')} className="hover:text-white ml-1"><X className="w-3 h-3" /></button>
                    </span>
                  )}
                  {selectedAsset && (
                    <span className="flex items-center gap-1 text-xs bg-purple-900/30 text-purple-300 border border-purple-800/40 px-2 py-1 rounded-full">
                      Vehicle: {selectedAsset}
                      <button onClick={() => setSelectedAsset('')} className="hover:text-white ml-1"><X className="w-3 h-3" /></button>
                    </span>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

      {/* ── Agent cards row ── */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 border-b border-gray-800/50">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.values(AGENT_TYPES).map(type => {
            const AgentIcon = AGENT_ICONS[type]
            const color = AGENT_COLORS[type]
            const isActive = activeAgent === type
            return (
              <div
                key={type}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${isActive ? `${color.bg} ${color.border} border` : 'bg-gray-900/40 border-gray-800/60'}`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${color.bg} border ${color.border}`}>
                  <AgentIcon className={`w-3.5 h-3.5 ${color.text}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-medium truncate ${isActive ? color.text : 'text-gray-300'}`}>
                    {AGENT_LABELS[type]}
                    {isActive && <span className="ml-1 inline-block w-1.5 h-1.5 bg-current rounded-full animate-pulse" />}
                  </p>
                  <p className="text-xs text-gray-600 truncate hidden sm:block">{AGENT_DESCRIPTIONS[type].split(',')[0]}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-5 min-h-0">

        {/* Empty state */}
        {messages.length === 0 && !loading && (
          <div className="max-w-2xl mx-auto text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/20 to-indigo-700/20 border border-blue-600/20 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-blue-400" />
            </div>
            <h2 className="text-white font-semibold text-lg mb-2">TyrePulse AI Command Center</h2>
            <p className="text-gray-400 text-sm mb-8 leading-relaxed">
              Ask any question about your fleet - tyre costs, failure analysis, data quality, or maintenance planning.
              The AI router automatically dispatches to the best specialist agent.
            </p>

            {/* Quick actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
              {QUICK_ACTIONS.map(action => {
                const color = AGENT_COLORS[action.agent]
                const AgentIcon = AGENT_ICONS[action.agent]
                return (
                  <button
                    key={action.label}
                    onClick={() => sendMessage(action.query)}
                    disabled={loading || dataLoading}
                    className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl border text-left transition-all hover:scale-[1.01] ${color.bg} ${color.border} border group`}
                  >
                    <AgentIcon className={`w-4 h-4 ${color.text} flex-shrink-0`} />
                    <span className={`text-sm font-medium ${color.text}`}>{action.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Typing indicator */}
        <AnimatePresence>
          {loading && activeAgent && (
            <TypingIndicator agentType={activeAgent} />
          )}
        </AnimatePresence>

        <div ref={chatEndRef} />
      </div>

      {/* ── Quick action chips (shown when chat has messages) ── */}
      {messages.length > 0 && (
        <div className="flex-shrink-0 px-4 sm:px-6 py-2 border-t border-gray-800/50 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {QUICK_ACTIONS.slice(0, 5).map(action => {
              const color = AGENT_COLORS[action.agent]
              return (
                <button
                  key={action.label}
                  onClick={() => sendMessage(action.query)}
                  disabled={loading}
                  className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40 ${color.bg} ${color.border} ${color.text} hover:brightness-110`}
                >
                  {action.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Input area ── */}
      <div className="flex-shrink-0 border-t border-gray-800 bg-gray-900/50 backdrop-blur-sm px-4 sm:px-6 py-4">

        {/* Agent preview */}
        {previewAgent && query.trim() && (
          <div className={`flex items-center gap-2 mb-2 text-xs ${AGENT_COLORS[previewAgent].text}`}>
            <Zap className="w-3 h-3" />
            Will route to: <span className="font-medium">{AGENT_LABELS[previewAgent]} Agent</span>
            <span className="text-gray-600">- {AGENT_DESCRIPTIONS[previewAgent]}</span>
          </div>
        )}

        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={dataLoading ? 'Loading fleet context...' : 'Ask about CPK, failures, root causes, planning, or data quality...'}
              disabled={loading || dataLoading}
              rows={1}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none disabled:opacity-50 transition-colors leading-relaxed"
              style={{ minHeight: '48px', maxHeight: '120px' }}
              onInput={e => {
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
              }}
            />
            <div className="absolute right-3 bottom-2.5 text-xs text-gray-600">
              {query.length > 0 && `${query.length}`}
            </div>
          </div>

          <button
            onClick={() => sendMessage()}
            disabled={!query.trim() || loading || dataLoading}
            className="flex-shrink-0 w-12 h-12 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center transition-colors shadow-lg"
          >
            {loading
              ? <RefreshCw className="w-4 h-4 text-white animate-spin" />
              : <Send className="w-4 h-4 text-white" />
            }
          </button>
        </div>

        <p className="text-xs text-gray-600 mt-2 text-center">
          AI responses are generated from your fleet data. Always validate critical decisions with your engineering team.
        </p>
      </div>
    </div>
  )
}
