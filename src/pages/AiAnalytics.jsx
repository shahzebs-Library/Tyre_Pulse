import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { detectAnomalies } from '../lib/anomalyEngine'
import { askAI, buildDataContext, DEEP_ANALYSIS_PRESETS, SUGGESTED_QUESTIONS } from '../lib/aiAnalytics'
import { AGENT_TYPES, AGENT_LABELS, AGENT_COLORS, AGENT_DESCRIPTIONS, classifyQuery } from '../lib/aiRouter'
import { exportToPdf, exportToExcel, exportDailyExecutivePdf } from '../lib/exportUtils'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  Sparkles, Download, FileText, ChevronRight, ChevronDown, Bot, Brain,
  DollarSign, Search, Activity, Calendar, BarChart2, Shield, Send,
  AlertTriangle, CheckCircle, Cpu, Zap, RefreshCw, X, Copy, Check,
  TrendingUp, Package,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler
)

const CHART_PALETTE = [
  'rgba(16,185,129,0.8)', 'rgba(59,130,246,0.8)', 'rgba(245,158,11,0.8)',
  'rgba(239,68,68,0.8)', 'rgba(99,102,241,0.8)', 'rgba(168,85,247,0.8)',
  'rgba(20,184,166,0.8)', 'rgba(34,197,94,0.8)', 'rgba(236,72,153,0.8)',
  'rgba(6,182,212,0.8)',
]

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#9ca3af', font: { size: 11 } } } },
  scales: { x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } }, y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } } },
}
const DOUGHNUT_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } } },
}

const PRESET_ICONS = { DollarSign, Search, Activity, Calendar, BarChart2, Shield }
const RISK_BADGE = {
  Low:      'text-green-300  bg-green-900/30  border-green-700/40',
  Medium:   'text-yellow-300 bg-yellow-900/30 border-yellow-700/40',
  High:     'text-orange-300 bg-orange-900/30 border-orange-700/40',
  Critical: 'text-red-300    bg-red-900/30    border-red-700/40',
}

function applyPalette(chartData) {
  if (!chartData) return chartData
  return {
    ...chartData,
    datasets: chartData.datasets.map((ds, i) => {
      const hasColors = Array.isArray(ds.backgroundColor) && ds.backgroundColor.length > 0 && !String(ds.backgroundColor[0]).startsWith('rgba(0')
      return hasColors ? ds : {
        ...ds,
        backgroundColor: chartData.labels.map((_, j) => CHART_PALETTE[(i + j) % CHART_PALETTE.length]),
        borderColor: chartData.labels.map((_, j) => CHART_PALETTE[(i + j) % CHART_PALETTE.length].replace('0.8', '1')),
        borderRadius: 5,
      }
    }),
  }
}

function AgentBadge({ agentType }) {
  const colors = AGENT_COLORS[agentType] ?? AGENT_COLORS[AGENT_TYPES.ANALYST]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${colors.bg} ${colors.text} ${colors.border}`}>
      <Bot size={9} />
      {AGENT_LABELS[agentType] ?? 'Analyst'}
    </span>
  )
}

function RiskBadge({ level }) {
  if (!level) return null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${RISK_BADGE[level] ?? 'text-gray-300 bg-gray-800 border-gray-700'}`}>
      {level}
    </span>
  )
}

function AiChart({ chartType, chartData, chartTitle }) {
  if (!chartType || chartType === 'none' || !chartData) return null
  const data = applyPalette(chartData)
  return (
    <div className="space-y-2">
      {chartTitle && <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{chartTitle}</h4>}
      <div style={{ height: 280 }}>
        {chartType === 'bar'      && <Bar      data={data} options={CHART_OPTS}     />}
        {chartType === 'line'     && <Line     data={data} options={CHART_OPTS}     />}
        {chartType === 'doughnut' && <Doughnut data={data} options={DOUGHNUT_OPTS} />}
      </div>
    </div>
  )
}

function AiTable({ tableHeaders, tableRows }) {
  if (!tableHeaders?.length || !tableRows?.length) return null
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-900/80">
            {tableHeaders.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-gray-400 border-b border-gray-800 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row, i) => (
            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-gray-300">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Single AI response message card
function ResponseCard({ item, onFollowUp, index }) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  function copyAnswer() {
    navigator.clipboard.writeText(item.response?.answer ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleExportPdf() {
    const { tableHeaders, tableRows, exportTitle, answer, insights, recommendations } = item.response ?? {}
    if (tableHeaders?.length && tableRows?.length) {
      const cols = tableHeaders.map((h, i) => ({ key: String(i), header: h }))
      const rows = tableRows.map(row => Object.fromEntries(tableHeaders.map((_, i) => [String(i), row[i] ?? ''])))
      exportToPdf(rows, cols, exportTitle || 'AI Analytics', exportTitle?.replace(/\s+/g,'_') || 'ai-analytics')
    }
  }

  function handleExportExcel() {
    const { tableHeaders, tableRows, exportTitle } = item.response ?? {}
    if (tableHeaders?.length && tableRows?.length) {
      const cols = tableHeaders.map((_, i) => String(i))
      const rows = tableRows.map(row => Object.fromEntries(tableHeaders.map((_, i) => [String(i), row[i] ?? ''])))
      exportToExcel(rows, cols, tableHeaders, exportTitle || 'ai-analytics')
    }
  }

  const r = item.response ?? {}
  const colors = AGENT_COLORS[r.agentType ?? AGENT_TYPES.ANALYST]

  return (
    <div className={`rounded-xl border ${colors.border} overflow-hidden`} style={{ background: 'rgba(10,14,20,0.9)' }}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2.5 ${colors.bg} border-b ${colors.border}`}>
        <div className="flex items-center gap-2 min-w-0">
          <AgentBadge agentType={r.agentType} />
          {r.riskLevel && <RiskBadge level={r.riskLevel} />}
          <span className="text-xs text-gray-400 truncate">{item.question}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          <button onClick={copyAnswer} className="p-1 rounded hover:bg-white/5 text-gray-600 hover:text-gray-300 transition-colors" title="Copy answer">
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
          {(r.tableHeaders?.length && r.tableRows?.length) ? (
            <>
              <button onClick={handleExportExcel} className="p-1 rounded hover:bg-white/5 text-gray-600 hover:text-gray-300 transition-colors" title="Export Excel">
                <Download size={12} />
              </button>
              <button onClick={handleExportPdf} className="p-1 rounded hover:bg-white/5 text-gray-600 hover:text-gray-300 transition-colors" title="Export PDF">
                <FileText size={12} />
              </button>
            </>
          ) : null}
          <button onClick={() => setExpanded(v => !v)} className="p-1 rounded hover:bg-white/5 text-gray-600 hover:text-gray-300 transition-colors">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Answer */}
          {r.answer && (
            <p className="text-sm text-gray-200 leading-relaxed">{r.answer}</p>
          )}

          {/* Insights */}
          {r.insights?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Key Insights</p>
              <ul className="space-y-1">
                {r.insights.map((ins, i) => (
                  <li key={i} className={`flex items-start gap-2 text-sm ${colors.text}`}>
                    <span className="mt-0.5 flex-shrink-0">•</span>
                    <span className="text-gray-300">{ins}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Root Cause */}
          {r.rootCause && (
            <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-700/30">
              <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-1">Root Cause Analysis</p>
              <p className="text-sm text-amber-200/80">{r.rootCause}</p>
            </div>
          )}

          {/* Chart */}
          {r.chartType && r.chartType !== 'none' && r.chartData && (
            <AiChart chartType={r.chartType} chartData={r.chartData} chartTitle={r.chartTitle} />
          )}

          {/* Table */}
          {r.tableHeaders?.length > 0 && r.tableRows?.length > 0 && (
            <AiTable tableHeaders={r.tableHeaders} tableRows={r.tableRows} />
          )}

          {/* Recommendations */}
          {r.recommendations?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Recommended Actions</p>
              <ul className="space-y-1.5">
                {r.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[8px] font-bold ${colors.bg} ${colors.text} border ${colors.border}`}>
                      {i + 1}
                    </div>
                    <span className="text-sm text-gray-300">{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Follow-up */}
          <div className="pt-2 border-t border-gray-800 flex items-center gap-2">
            <span className="text-[10px] text-gray-600">Follow up:</span>
            {['Tell me more', 'Which assets are affected?', 'Show cost impact', 'Create action plan'].map(q => (
              <button key={q} onClick={() => onFollowUp?.(q, r.agentType)}
                className="text-[10px] px-2 py-1 rounded-full text-gray-500 border border-gray-700 hover:border-gray-500 hover:text-gray-300 transition-colors">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function AiAnalytics() {
  const { activeCountry, appSettings } = useSettings()

  const [records, setRecords]         = useState([])
  const [inspections, setInspections] = useState([])
  const [actions, setActions]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [question, setQuestion]       = useState('')
  const [asking, setAsking]           = useState(false)
  const [messages, setMessages]       = useState([])  // conversation history
  const [error, setError]             = useState(null)
  const [agentType, setAgentType]     = useState(AGENT_TYPES.ANALYST)
  const [autoDetect, setAutoDetect]   = useState(true)

  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => { load() }, [activeCountry])

  async function load() {
    setLoading(true)
    const cf = activeCountry !== 'All' ? activeCountry : null
    const flt = q => cf ? q.eq('country', cf) : q
    const [tyreRes, inspRes, actionRes] = await Promise.all([
      fetchAllPages((from, to) => flt(supabase.from('tyre_records').select('id,issue_date,brand,site,asset_no,category,risk_level,cost_per_tyre,qty,serial_no,created_at,country').order('issue_date', { ascending: true })).range(from, to), { max: 200000 }),
      supabase.from('inspections').select('id,status,severity,scheduled_date,site,findings,inspector').order('scheduled_date', { ascending: false }).limit(100),
      supabase.from('corrective_actions').select('id,title,priority,site,status,assigned_to').order('created_at', { ascending: false }).limit(50),
    ])
    setRecords(tyreRes.data ?? [])
    setInspections(inspRes.data ?? [])
    setActions(actionRes.data ?? [])
    setLoading(false)
  }

  const anomalies   = useMemo(() => detectAnomalies(records), [records])
  const dataContext = useMemo(() => buildDataContext(records, anomalies, inspections, actions), [records, anomalies, inspections, actions])

  // Auto-detect best agent from question
  useEffect(() => {
    if (autoDetect && question.length > 8) {
      const detected = classifyQuery(question)
      setAgentType(detected)
    }
  }, [question, autoDetect])

  async function handleAsk(q, forceAgent) {
    const finalQ = (q ?? question).trim()
    if (!finalQ || asking) return
    const finalAgent = forceAgent ?? agentType

    setAsking(true)
    setError(null)
    setQuestion('')

    // Build history for context (last 6 exchanges)
    const historyForApi = messages.slice(-6).flatMap(m => [
      { role: 'user',      content: m.question },
      { role: 'assistant', content: JSON.stringify(m.response) },
    ])

    try {
      const result = await askAI(finalQ, dataContext, finalAgent, historyForApi)
      const newMsg = { question: finalQ, response: result, agent: finalAgent, ts: Date.now() }
      setMessages(prev => [...prev, newMsg])
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (err) {
      setError(err.message || 'AI request failed. Please check your connection and try again.')
    } finally {
      setAsking(false)
    }
  }

  function handleFollowUp(q, agent) {
    setQuestion(q)
    handleAsk(q, agent)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAsk()
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() }
  }

  function clearConversation() {
    setMessages([])
    setError(null)
  }

  const hasTyreData  = records.length > 0
  const totalCostFmt = `SAR ${(dataContext.summary?.totalCost || 0).toLocaleString()}`

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">Loading fleet data…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet AI"
        subtitle="Multi-agent fleet intelligence · Analyst · Tyre Engineer · Planner · QA Data"
        icon={Brain}
      />

      {/* ── Data Stats Strip ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Records Loaded',   value: records.length.toLocaleString(),              icon: Package,       color: 'text-green-400' },
          { label: 'Total Cost',       value: totalCostFmt,                                  icon: DollarSign,    color: 'text-teal-400' },
          { label: 'High Risk Tyres',  value: (dataContext.summary?.highRiskCount || 0).toLocaleString(), icon: AlertTriangle, color: 'text-red-400' },
          { label: 'Open Actions',     value: (dataContext.actions?.open || 0).toLocaleString(),           icon: Activity,      color: 'text-yellow-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card flex items-center gap-3 py-3">
            <Icon size={16} className={color} />
            <div>
              <p className={`text-lg font-bold ${color} leading-none`}>{value}</p>
              <p className="text-gray-500 text-xs mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* ── LEFT: Chat ─────────────────────────────────────────────────── */}
        <div className="xl:col-span-2 flex flex-col gap-4">

          {/* Agent Selector */}
          <div className="card py-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Active Agent</p>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <div
                  onClick={() => setAutoDetect(v => !v)}
                  className={`w-8 h-4 rounded-full transition-colors cursor-pointer relative ${autoDetect ? 'bg-green-600' : 'bg-gray-700'}`}>
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${autoDetect ? 'left-4.5 translate-x-0.5' : 'left-0.5'}`} style={{ left: autoDetect ? '18px' : '2px' }} />
                </div>
                Auto-detect
              </label>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.values(AGENT_TYPES).map(type => {
                const colors = AGENT_COLORS[type]
                const isActive = agentType === type
                return (
                  <button
                    key={type}
                    onClick={() => { setAgentType(type); setAutoDetect(false) }}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      isActive ? `${colors.bg} ${colors.border} ${colors.text}` : 'bg-gray-900/50 border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                    }`}
                  >
                    <p className="text-xs font-bold">{AGENT_LABELS[type]}</p>
                    <p className="text-[10px] mt-0.5 opacity-70 leading-tight">{AGENT_DESCRIPTIONS[type].split(',')[0]}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Conversation */}
          <div className="card flex-1 space-y-3" style={{ minHeight: '300px', maxHeight: '600px', overflowY: 'auto' }}>
            {messages.length === 0 && !asking && (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-green-900/20 border border-green-700/30 flex items-center justify-center">
                  <Brain size={20} className="text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-300">Ask anything about your fleet</p>
                  <p className="text-xs text-gray-600 mt-1">Use the suggested questions or deep analysis presets to get started</p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <ResponseCard key={msg.ts} item={msg} index={i} onFollowUp={handleFollowUp} />
            ))}

            {asking && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900/60 border border-gray-800">
                <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="text-sm text-gray-400">
                  <AgentBadge agentType={agentType} />
                  <span className="ml-2">Analysing fleet data…</span>
                </p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-950/30 border border-red-700/40">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-300">Error</p>
                  <p className="text-xs text-red-400 mt-0.5">{error}</p>
                </div>
                <button onClick={() => setError(null)} className="ml-auto text-red-600 hover:text-red-400"><X size={12} /></button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="card space-y-2 py-3">
            <div className="flex items-start gap-2">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-1 ${AGENT_COLORS[agentType].bg} border ${AGENT_COLORS[agentType].border}`}>
                <Bot size={12} className={AGENT_COLORS[agentType].text} />
              </div>
              <textarea
                ref={textareaRef}
                rows={2}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask ${AGENT_LABELS[agentType]}… (Enter to send)`}
                className="flex-1 bg-transparent resize-none text-sm text-gray-200 placeholder-gray-600 outline-none"
                disabled={asking}
              />
              <div className="flex flex-col gap-1 flex-shrink-0">
                <button
                  onClick={() => handleAsk()}
                  disabled={!question.trim() || asking}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ background: asking ? '#166534' : '#15803d' }}
                >
                  <Send size={13} />
                </button>
                {messages.length > 0 && (
                  <button onClick={clearConversation} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-950/20 transition-colors" title="Clear conversation">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between pl-8">
              <p className="text-[10px] text-gray-700">
                {records.length} records · {anomalies.length} anomalies · {inspections.length} inspections
                {activeCountry !== 'All' ? ` · ${activeCountry}` : ' · All countries'}
              </p>
              <button onClick={load} className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors">
                <RefreshCw size={10} /> Refresh data
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Tools Panel ──────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Deep Analysis Presets */}
          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <Zap size={13} className="text-yellow-400" />
              <p className="text-xs font-bold text-gray-300 uppercase tracking-widest">Deep Analysis</p>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {DEEP_ANALYSIS_PRESETS.map(preset => {
                const IconComp = PRESET_ICONS[preset.icon] ?? Sparkles
                const agentColors = AGENT_COLORS[preset.agentType]
                return (
                  <button
                    key={preset.id}
                    onClick={() => { setAgentType(preset.agentType); setAutoDetect(false); handleAsk(preset.question, preset.agentType) }}
                    disabled={asking}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all disabled:opacity-40 ${agentColors.bg} ${agentColors.border} hover:opacity-90`}
                  >
                    <IconComp size={14} className={agentColors.text} />
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold ${agentColors.text}`}>{preset.label}</p>
                      <p className="text-[10px] text-gray-600 mt-0.5">{AGENT_LABELS[preset.agentType]}</p>
                    </div>
                    <ChevronRight size={11} className="text-gray-600 ml-auto flex-shrink-0" />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Suggested Questions */}
          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles size={13} className="text-blue-400" />
              <p className="text-xs font-bold text-gray-300 uppercase tracking-widest">Suggested Questions</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(SUGGESTED_QUESTIONS[agentType] ?? SUGGESTED_QUESTIONS.analyst).map(q => (
                <button
                  key={q}
                  onClick={() => { setQuestion(q); textareaRef.current?.focus() }}
                  className="px-2.5 py-1 rounded-full text-[10px] font-medium text-gray-400 border border-gray-700 hover:border-green-600/60 hover:text-green-400 hover:bg-green-900/10 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Fleet Snapshot */}
          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={13} className="text-green-400" />
              <p className="text-xs font-bold text-gray-300 uppercase tracking-widest">Fleet Snapshot</p>
            </div>
            <div className="space-y-2">
              {[
                { label: 'Critical Tyres',     value: dataContext.summary?.criticalCount ?? 0,  bar: (dataContext.summary?.criticalCount / (records.length || 1)) * 100, color: 'bg-red-500' },
                { label: 'High Risk Tyres',     value: dataContext.summary?.highRiskCount ?? 0,  bar: (dataContext.summary?.highRiskCount / (records.length || 1)) * 100, color: 'bg-orange-500' },
                { label: 'Open Actions',        value: dataContext.actions?.open ?? 0,            bar: Math.min(100, (dataContext.actions?.open / 20) * 100),              color: 'bg-yellow-500' },
                { label: 'Inspection Issues',   value: (dataContext.inspections?.critical ?? 0) + (dataContext.inspections?.high ?? 0), bar: Math.min(100, ((dataContext.inspections?.critical ?? 0) / (dataContext.inspections?.total || 1)) * 100 * 2), color: 'bg-purple-500' },
              ].map(({ label, value, bar, color }) => (
                <div key={label}>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-gray-500">{label}</span>
                    <span className="text-gray-300 font-semibold">{value}</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, bar)}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Top sites quick view */}
            {dataContext.bySite?.length > 0 && (
              <div className="pt-2 border-t border-gray-800">
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Top Sites by Cost</p>
                {dataContext.bySite.slice(0, 4).map((site, i) => (
                  <div key={site.name} className="flex items-center justify-between text-[11px] mb-1.5">
                    <span className="text-gray-400 truncate max-w-[120px]">{site.name}</span>
                    <span className="text-gray-300 font-semibold ml-2">SAR {site.cost.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conversation summary */}
          {messages.length > 0 && (
            <div className="card space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu size={13} className="text-purple-400" />
                  <p className="text-xs font-bold text-gray-300 uppercase tracking-widest">Session</p>
                </div>
                <button onClick={clearConversation} className="text-[10px] text-gray-600 hover:text-red-400 flex items-center gap-1">
                  <X size={10} /> Clear
                </button>
              </div>
              <p className="text-xs text-gray-500">{messages.length} question{messages.length !== 1 ? 's' : ''} asked</p>
              {messages.slice(-3).reverse().map((m, i) => (
                <div key={m.ts} className="flex items-center gap-2 text-[10px]">
                  <AgentBadge agentType={m.agent} />
                  <span className="text-gray-600 truncate">{m.question.slice(0, 45)}{m.question.length > 45 ? '…' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
