// ─────────────────────────────────────────────────────────────────────────────
// AiCommandCenter.jsx - Smart Analytics (AI), the multi-agent AI interface
// Route: /ai-command-center. Rebuilt on the Command Center kit to the owner's
// mockup. The insight feed is the fleet's real active alerts routed to an
// agent; the tiles are real counts (alerts, ai_token_logs usage, saved
// conversations). Nothing AI-generated is shown as a stored number.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Copy, Check, Download, RefreshCw, Trash2,
  ChevronDown, ChevronUp, BarChart2, ChevronRight,
  ClipboardList, Cpu, Zap, Bot, Sparkles, MessageSquarePlus, Archive,
  TrendingUp, TrendingDown, Minus, Clock, Database, ShieldAlert, ShoppingCart,
  AlertTriangle, CalendarDays, ShieldCheck, History, RotateCcw, Eye, Lightbulb, Coins, MessagesSquare,
} from 'lucide-react'
import { classifyQuery, AGENT_TYPES, AGENT_LABELS, AGENT_COLORS, AGENT_DESCRIPTIONS } from '../lib/aiRouter'
import {
  archiveConversation, listConversationMessages, listConversations, sendOrchestratorMessage,
} from '../lib/aiOrchestratorClient'
import { getUsageOverview } from '../lib/api/aiOps'
import { supabase } from '../lib/supabase'
import { toUserMessage } from '../lib/safeError'
import { formatDateTime } from '../lib/formatters'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState } from '../lib/exportUtils'
import { Card, CardState, Kpi, Tabs, KitTable, ViewAll, useCard } from '../components/commandCenter/kit'
import {
  MAX_QUESTION, SEVERITIES, agentTone, signalFeed, signalCounts, filterSignals,
  aiKpis, traceRows, clampQuestion,
} from '../lib/aiCommandCenterView'
import './AiCommandCenter.css'

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
  { label: 'Safety & compliance review',   query: 'Review fleet safety: accidents, inspection compliance and open corrective actions. Where is the biggest risk and what should we fix first?', agent: AGENT_TYPES.SAFETY },
  { label: 'Best value brand to buy',      query: 'Which tyre brand should we buy next based on realized cost per km, life and failure rate? Give a procurement plan.', agent: AGENT_TYPES.PROCUREMENT },
]

const AGENT_ICONS = {
  [AGENT_TYPES.ANALYST]:       BarChart2,
  [AGENT_TYPES.TYRE_ENGINEER]: Cpu,
  [AGENT_TYPES.QA_DATA]:       Database,
  [AGENT_TYPES.PLANNER]:       ClipboardList,
  [AGENT_TYPES.SAFETY]:        ShieldAlert,
  [AGENT_TYPES.PROCUREMENT]:   ShoppingCart,
}

const KPI_ICONS = {
  critical: AlertTriangle, open: Lightbulb, requests: Zap, spend: Coins, success: ShieldCheck, conversations: MessagesSquare,
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
          {expanded && (message.sources?.length > 0 || message.usage) && (
            <div className="mt-4 pt-3 border-t border-[var(--input-border)]/60 text-xs text-[var(--text-muted)]">
              {message.sources?.length > 0 && (
                <div className="flex flex-wrap gap-1.5" aria-label="AI response sources">
                  <span className="font-medium text-[var(--text-secondary)]">Sources:</span>
                  {message.sources.map(source => (
                    <span key={source.id} className="px-2 py-0.5 rounded-full bg-[var(--surface-1)] border border-[var(--input-border)]">
                      {source.label} : {source.status}
                    </span>
                  ))}
                </div>
              )}
              {message.usage && (
                <p className="mt-2 tabular-nums" aria-label="AI request usage">
                  {Number(message.usage.total_tokens || 0).toLocaleString()} tokens, estimated ${Number(message.usage.estimated_cost_usd || 0).toFixed(6)}, {message.usage.model}
                </p>
              )}
            </div>
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

const USAGE_DAYS = 30
const SEV_FILTERS = ['all', ...SEVERITIES]

async function loadSignals() {
  const { data, error } = await supabase
    .from('alerts')
    .select('id,asset_no,alert_type,severity,message,created_at,country')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data ?? []
}

export default function AiCommandCenter() {
  const { appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [messages, setMessages]           = useState([])
  const [query, setQuery]                 = useState('')
  const [loading, setLoading]             = useState(false)
  const [activeAgent, setActiveAgent]     = useState(null)
  const [conversations, setConversations] = useState([])
  const [conversationId, setConversationId] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError]   = useState('')
  const [previewAgent, setPreviewAgent]   = useState(null)
  // Agent routing: null = automatic (the router picks), else a forced agent.
  const [forcedAgent, setForcedAgent]     = useState(null)
  const [sevFilter, setSevFilter]         = useState('all')
  const [feedSort, setFeedSort]           = useState('severity')
  const [showAllPrompts, setShowAllPrompts] = useState(false)
  const [now] = useState(() => new Date())

  const chatEndRef   = useRef(null)
  const inputRef     = useRef(null)
  const requestRef   = useRef(0)
  const traceRef     = useRef(null)
  const chatRef      = useRef(null)

  // Real fleet signals (active alerts) and real AI usage (ai_token_logs).
  const signals = useCard(loadSignals, [])
  const usage = useCard(() => getUsageOverview({ days: USAGE_DAYS }), [])

  // ── Load initial context data ───────────────────────────────────────────────

  const refreshConversations = useCallback(async () => {
    const rows = await listConversations()
    setConversations(rows)
    return rows
  }, [])

  const loadHistory = useCallback(() => {
    let live = true
    setHistoryLoading(true)
    setHistoryError('')
    refreshConversations()
      .catch((e) => { if (live) setHistoryError(toUserMessage(e, 'Conversation history is unavailable.')) })
      .finally(() => { if (live) setHistoryLoading(false) })
    return () => { live = false }
  }, [refreshConversations])

  useEffect(() => {
    const stop = loadHistory()
    return () => { stop(); requestRef.current += 1 }
  }, [loadHistory])

  // ── Auto-scroll ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (messages.length || loading) chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, loading])

  // ── Preview agent type as user types ───────────────────────────────────────

  useEffect(() => {
    if (query.trim().length > 3) {
      setPreviewAgent(classifyQuery(query))
    } else {
      setPreviewAgent(null)
    }
  }, [query])

  // ── Send message ─────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (queryText = query, agentOverride = null) => {
    const text = String(queryText ?? '').trim()
    if (!text || loading) return

    const requestId = ++requestRef.current
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const agentType = agentOverride || forcedAgent || classifyQuery(text)

    const userMsg = { id: Date.now(), role: 'user', content: text, timestamp }
    setMessages(prev => [...prev, userMsg])
    setQuery('')
    setLoading(true)
    setActiveAgent(agentType)
    chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    try {
      const result = await sendOrchestratorMessage({
        message: text,
        conversationId,
        agent: agentType || 'auto',
      })

      if (requestId !== requestRef.current) return

      const aiMsg = {
        id:          Date.now() + 1,
        role:        'assistant',
        content:     result.content,
        agentType,
        toolCalls:   result.tool_calls ?? [],
        sources:     result.sources ?? [],
        usage:       result.usage,
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
      setConversationId(result.conversation_id)
      refreshConversations().catch(() => setHistoryError('Conversation saved, but history could not be refreshed.'))
    } catch (err) {
      console.error('Agent error:', err)
      if (requestId === requestRef.current) {
        setMessages(prev => [...prev, {
          id:        Date.now() + 1,
          role:      'assistant',
          content:   toUserMessage(err, 'An error occurred while processing your query. Please check your connection and try again.'),
          agentType,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }])
      }
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false)
        setActiveAgent(null)
      }
    }
  }, [query, loading, conversationId, refreshConversations, forcedAgent])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function clearChat() {
    requestRef.current += 1
    setMessages([])
    setConversationId(null)
    setLoading(false)
    setActiveAgent(null)
  }

  const openConversation = useCallback(async (conversation) => {
    if (loading) return
    const requestId = ++requestRef.current
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const rows = await listConversationMessages(conversation.id)
      if (requestId !== requestRef.current) return
      setMessages(rows.filter(row => row.role !== 'tool').map(row => ({
        id: row.id,
        role: row.role,
        content: row.content,
        agentType: row.role === 'assistant' ? (conversation.agent || AGENT_TYPES.ANALYST) : null,
        timestamp: row.created_at ? new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      })))
      setConversationId(conversation.id)
      chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch {
      if (requestId === requestRef.current) setHistoryError('This conversation could not be loaded.')
    } finally {
      if (requestId === requestRef.current) setHistoryLoading(false)
    }
  }, [loading])

  const handleArchive = useCallback(async (id) => {
    if (loading) return
    setHistoryError('')
    try {
      await archiveConversation(id)
      if (conversationId === id) clearChat()
      await refreshConversations()
    } catch {
      setHistoryError('This conversation could not be archived.')
    }
  }, [conversationId, loading, refreshConversations])

  // ── Export chat as PDF ──────────────────────────────────────────────────────

  async function exportChatPdf() {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 15
    const maxWidth = pageWidth - margin * 2
    const brand = await resolvePdfBrand(branding)

    pdfHeader(doc, 'Smart Analytics (AI) - Chat Export', 'Secure orchestrator conversation', company, brand)

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

  // ── Derived view data (pure, src/lib/aiCommandCenterView.js) ───────────────

  const feed = useMemo(() => {
    const items = signalFeed(signals.data || [], now)
    return feedSort === 'newest' ? [...items].sort((a, b) => b.at - a.at) : items
  }, [signals.data, now, feedSort])
  const counts = useMemo(() => signalCounts(feed), [feed])
  const shownFeed = useMemo(() => filterSignals(feed, sevFilter), [feed, sevFilter])
  const kpis = useMemo(() => aiKpis({
    signals: feed,
    signalsReady: !!signals.data && !signals.error,
    usage: usage.data?.summary || null,
    usageReady: !!usage.data && !usage.error,
    conversations,
    conversationsReady: !historyLoading && !historyError,
    days: USAGE_DAYS,
  }), [feed, signals.data, signals.error, usage.data, usage.error, conversations, historyLoading, historyError])
  const trace = useMemo(() => traceRows(conversations), [conversations])
  const rangeLabel = useMemo(() => {
    const from = new Date(now.getTime() - USAGE_DAYS * 86400000)
    const f = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    return `${f(from)} to ${f(now)}`
  }, [now])
  const routedAgent = forcedAgent || previewAgent
  const prompts = showAllPrompts ? QUICK_ACTIONS : QUICK_ACTIONS.slice(0, 4)
  const kpiLoading = { critical: signals.loading, open: signals.loading, requests: usage.loading, spend: usage.loading, success: usage.loading, conversations: historyLoading }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="cc ai-page">
      <header className="ai-head">
        <div className="ai-head-copy">
          <nav aria-label="Breadcrumb" className="ai-crumb">
            Analytics &amp; Reports <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">Smart Analytics (AI)</span>
          </nav>
          <div className="ai-title-row">
            <span className="ai-title-icon" aria-hidden="true"><Bot size={26} /></span>
            <div>
              <h1>Smart Analytics (AI)</h1>
              <p>Multi-agent fleet intelligence using Analyst, Tyre Engineer, QA, Planner, Safety and Procurement agents, with the sources each answer read.</p>
            </div>
          </div>
        </div>
        <div className="ai-head-actions">
          <div className="cc-card ai-range">
            <CalendarDays size={17} aria-hidden="true" />
            <div><b>{rangeLabel}</b><span>AI usage, last {USAGE_DAYS} days</span></div>
          </div>
          <span className="cc-pill good ai-secure"><ShieldCheck size={13} aria-hidden="true" /> Secure server orchestration</span>
          <button type="button" className="cc-btn-primary" onClick={exportChatPdf} disabled={messages.length === 0}
            title={messages.length === 0 ? 'Ask a question first, then export the conversation' : 'Export this conversation as PDF'}>
            <Download size={15} aria-hidden="true" /> Export Report
          </button>
        </div>
      </header>

      <div className="cc-kpis ai-kpis">
        {kpis.map((k) => (
          <Kpi
            key={k.key}
            icon={KPI_ICONS[k.key]}
            tone={k.tone}
            value={k.value}
            display={k.display ?? (k.value == null && !kpiLoading[k.key] ? 'N/A' : undefined)}
            loading={kpiLoading[k.key]}
            danger={k.danger}
            label={<>{k.label}<span className="ai-kpi-sub">{k.sub}</span></>}
          />
        ))}
      </div>

      <div className="ai-grid">
        <Card
          className="ai-feed"
          title="AI Insight Feed"
          sub="Live fleet alerts, each routed to the agent best placed to explain it"
          action={(
            <select className="cc-select" aria-label="Sort signals" value={feedSort} onChange={(e) => setFeedSort(e.target.value)}>
              <option value="severity">Most severe first</option>
              <option value="newest">Newest first</option>
            </select>
          )}
        >
          <Tabs
            label="Filter by severity"
            value={sevFilter}
            onChange={setSevFilter}
            tabs={SEV_FILTERS.map((s) => ({ key: s, label: s === 'all' ? 'All signals' : s, count: s === 'all' ? counts.all : counts[s] }))}
          />
          <div className="ai-feed-body">
            <CardState
              state={signals}
              lines={5}
              empty={signals.data && !shownFeed.length ? (
                <div>
                  {feed.length ? 'No signals at this severity.' : 'No active fleet alerts right now. Ask a question below to run an agent.'}
                  <br /><ViewAll to="/alerts" label="Open alerts" />
                </div>
              ) : null}
            >
              <ul className="ai-feed-list">
                {shownFeed.slice(0, 12).map((s) => {
                  const tone = agentTone(s.agent)
                  const AgentIcon = AGENT_ICONS[s.agent] ?? Bot
                  return (
                    <li key={s.id} className="ai-signal">
                      <span className={`ai-signal-icon tone-${s.tone}`} aria-hidden="true"><AlertTriangle size={20} /></span>
                      <div className="ai-signal-main">
                        <div className="ai-signal-title">
                          <b>{s.title}</b>
                          <span className={`cc-pill ${s.tone}`}>{s.severity}</span>
                        </div>
                        <p title={s.message}>{s.message}</p>
                        <span className="ai-signal-meta">{[s.asset, s.country, s.ago].filter(Boolean).join(' : ') || 'No asset recorded'}</span>
                      </div>
                      <span className={`cc-pill ${tone.pill} ai-agent-chip`}><AgentIcon size={12} aria-hidden="true" /> {s.agentLabel} Agent</span>
                      <button type="button" className="cc-btn ai-ask-btn" disabled={loading}
                        onClick={() => sendMessage(s.question, s.agent)}>
                        Ask agent
                      </button>
                    </li>
                  )
                })}
              </ul>
              {shownFeed.length > 12 && <p className="ai-muted">Showing the 12 most relevant of {shownFeed.length} signals. <ViewAll to="/alerts" label="See all alerts" /></p>}
            </CardState>
          </div>
        </Card>

        <Card
          className="ai-ask"
          title="Ask TyrePulse AI"
          sub="Get answers, analysis and recommendations from the TyrePulse agents."
          action={(
            <button type="button" className="cc-btn-ghost" onClick={() => traceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <History size={14} aria-hidden="true" /> View Chat History
            </button>
          )}
        >
          <div className="ai-input-wrap">
            <textarea
              ref={inputRef}
              className="ai-input"
              value={query}
              onChange={e => setQuery(clampQuestion(e.target.value))}
              onKeyDown={handleKeyDown}
              maxLength={MAX_QUESTION}
              placeholder="Ask a question about your fleet, tyres, costs, risks or maintenance..."
              disabled={loading}
              rows={3}
              aria-label="Question for TyrePulse AI"
            />
            <span className="ai-count">{query.length}/{MAX_QUESTION}</span>
          </div>

          <div className="ai-prompts">
            {prompts.map((action) => (
              <button key={action.label} type="button" className="ai-prompt" disabled={loading}
                onClick={() => sendMessage(action.query, action.agent)}>
                {action.label}
              </button>
            ))}
            <button type="button" className="ai-prompt ai-prompt-more" onClick={() => setShowAllPrompts(v => !v)}>
              {showAllPrompts ? 'Fewer suggestions' : `More suggestions (${QUICK_ACTIONS.length - 4})`}
            </button>
          </div>

          <div className="ai-routing">
            <span className="ai-label">Agent routing</span>
            <div className="ai-agents" role="radiogroup" aria-label="Agent routing">
              <button type="button" role="radio" aria-checked={forcedAgent == null}
                className={`ai-agent ${forcedAgent == null ? 'is-on' : ''}`} onClick={() => setForcedAgent(null)}>
                <span className="cc-kpi-icon t-green"><Zap size={16} aria-hidden="true" /></span>
                <span><b>Automatic</b><small>Router picks the agent</small></span>
              </button>
              {Object.values(AGENT_TYPES).map((type) => {
                const AgentIcon = AGENT_ICONS[type]
                const on = forcedAgent === type
                const busy = activeAgent === type
                return (
                  <button key={type} type="button" role="radio" aria-checked={on}
                    className={`ai-agent ${on ? 'is-on' : ''}`} onClick={() => setForcedAgent(on ? null : type)}
                    title={AGENT_DESCRIPTIONS[type]}>
                    <span className={`cc-kpi-icon ${agentTone(type).icon}`}><AgentIcon size={16} aria-hidden="true" /></span>
                    <span>
                      <b>{AGENT_LABELS[type]}{busy && <i className="ai-busy" aria-label="working" />}</b>
                      <small>{AGENT_DESCRIPTIONS[type].split(',')[0]}</small>
                    </span>
                  </button>
                )
              })}
            </div>
            {routedAgent && (query.trim() || forcedAgent) && (
              <p className="ai-route-note">
                <Zap size={12} aria-hidden="true" /> {forcedAgent ? 'Will send to' : 'Will route to'} <b>{AGENT_LABELS[routedAgent]} Agent</b>: {AGENT_DESCRIPTIONS[routedAgent]}
              </p>
            )}
          </div>

          <div className="ai-evidence">
            <span className="ai-label">Evidence and scope</span>
            <ul>
              <li><Check size={14} aria-hidden="true" /> Every answer lists the records and sources it read.</li>
              <li><Check size={14} aria-hidden="true" /> Answers are read-only recommendations; nothing is changed in your data.</li>
              <li><Check size={14} aria-hidden="true" /> Data scope follows your access: organisation, country and site.</li>
            </ul>
          </div>

          <div className="ai-run">
            <button type="button" className="cc-btn-primary ai-run-btn" onClick={() => sendMessage()} disabled={!query.trim() || loading}>
              {loading ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
              {loading ? 'Running analysis...' : 'Run Analysis'}
            </button>
            <button type="button" className="cc-btn-ghost" onClick={() => { setQuery(''); setForcedAgent(null) }} disabled={loading}>
              <RotateCcw size={14} aria-hidden="true" /> Clear
            </button>
          </div>
        </Card>
      </div>

      <div ref={chatRef}>
        <Card
          title="Conversation"
          sub={conversationId ? 'Saved to your history as you go' : 'A new conversation starts with your first question'}
          action={messages.length > 0 ? (
            <span className="ai-actions">
              <button type="button" className="cc-btn-ghost" onClick={exportChatPdf}><Download size={14} aria-hidden="true" /> Export PDF</button>
              <button type="button" className="cc-btn-ghost" onClick={clearChat}><Trash2 size={14} aria-hidden="true" /> Clear</button>
            </span>
          ) : null}
        >
          {messages.length === 0 && !loading ? (
            <div className="cc-empty ai-chat-empty">
              <div>
                <Sparkles size={26} aria-hidden="true" />
                <p>Ask a question, pick a suggestion, or send a signal from the feed to an agent. The answer appears here with the sources it used.</p>
              </div>
            </div>
          ) : (
            <div className="ai-chat">
              {messages.map(msg => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              <AnimatePresence>
                {loading && activeAgent && (
                  <TypingIndicator agentType={activeAgent} />
                )}
              </AnimatePresence>
              <div ref={chatEndRef} />
            </div>
          )}
          <p className="ai-muted ai-disclaimer">AI responses are generated from your fleet data. Always validate critical decisions with your engineering team.</p>
        </Card>
      </div>

      <div ref={traceRef}>
        <Card
          title="Prediction & Recommendation Trace"
          sub="Saved conversations and the agent that answered. Confidence and predicted impact are not stored per answer, so they are not shown."
          action={(
            <button type="button" className="cc-btn" onClick={clearChat} disabled={loading}>
              <MessageSquarePlus size={13} aria-hidden="true" /> New chat
            </button>
          )}
        >
          {historyError && (
            <div className="cc-card ai-banner" role="alert">
              <span>{historyError}</span>
              <button type="button" className="cc-btn-ghost" onClick={loadHistory}>Try again</button>
            </div>
          )}
          <KitTable
            rows={trace}
            loading={historyLoading && !trace.length}
            empty="No saved conversations yet. Your first question starts one."
            onRowClick={(r) => { const c = conversations.find((x) => x.id === r.id); if (c) openConversation(c) }}
            columns={[
              { key: 'n', header: '#', numeric: true },
              { key: 'title', header: 'Conversation', cell: (r) => <span className={`ai-trace-title ${conversationId === r.id ? 'is-open' : ''}`} title={r.title}>{r.title}</span> },
              {
                key: 'agent', header: 'Agent',
                cell: (r) => <span className={`cc-pill ${agentTone(r.agent).pill}`}>{r.agentLabel}</span>,
              },
              { key: 'created', header: 'Started', cell: (r) => (r.created ? formatDateTime(r.created) : <span className="cc-na">N/A</span>) },
              { key: 'updated', header: 'Last Updated', cell: (r) => (r.updated ? formatDateTime(r.updated) : <span className="cc-na">N/A</span>) },
              {
                key: 'status', header: 'Status', sortable: false,
                cell: (r) => <span className={`cc-pill ${conversationId === r.id ? 'good' : 'muted'}`}>{conversationId === r.id ? 'Open now' : 'Saved'}</span>,
              },
              {
                key: 'actions', header: 'Actions', sortable: false,
                cell: (r) => (
                  <span className="ai-actions" onClick={(e) => e.stopPropagation()} role="presentation">
                    <button type="button" className="cc-icon-btn" disabled={loading}
                      onClick={() => { const c = conversations.find((x) => x.id === r.id); if (c) openConversation(c) }}
                      aria-label={`Open ${r.title}`} title="Open"><Eye size={14} /></button>
                    <button type="button" className="cc-icon-btn" disabled={loading}
                      onClick={() => handleArchive(r.id)} aria-label={`Archive ${r.title}`} title="Archive"><Archive size={14} /></button>
                  </span>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </div>
  )
}
