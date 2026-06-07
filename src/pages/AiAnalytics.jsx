import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { detectAnomalies } from '../lib/anomalyEngine'
import { askAI, buildDataContext } from '../lib/aiAnalytics'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { Sparkles, Download, FileText, ChevronRight } from 'lucide-react'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler)

const SUGGESTED_QUESTIONS = [
  'Which site has the highest tyre cost?',
  'Show monthly cost trend for last 6 months',
  'Which brand has the most blowouts?',
  'Which vehicles have the most anomalies?',
  'Top 5 failure categories',
  'Compare high-risk rates by site',
  'Which assets cost the most to maintain?',
  'Cost breakdown by risk level',
]

const CHART_PALETTE = [
  'rgba(16,185,129,0.75)',
  'rgba(20,184,166,0.75)',
  'rgba(6,182,212,0.75)',
  'rgba(59,130,246,0.75)',
  'rgba(99,102,241,0.75)',
  'rgba(168,85,247,0.75)',
  'rgba(236,72,153,0.75)',
  'rgba(245,158,11,0.75)',
  'rgba(239,68,68,0.75)',
  'rgba(34,197,94,0.75)',
]

const CHART_OPTS_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af' } },
    title: { display: false },
  },
  scales: {
    x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
  },
}

const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { color: '#9ca3af' } },
    title: { display: false },
  },
}

function applyPalette(chartData) {
  if (!chartData) return chartData
  return {
    ...chartData,
    datasets: chartData.datasets.map((ds, i) => {
      const hasColors = Array.isArray(ds.backgroundColor) && ds.backgroundColor.length > 0
        && !ds.backgroundColor[0]?.startsWith('rgba(0,0,0')
      if (hasColors) return ds
      return {
        ...ds,
        backgroundColor: chartData.labels.map((_, j) => CHART_PALETTE[(i + j) % CHART_PALETTE.length]),
        borderColor: chartData.labels.map((_, j) => CHART_PALETTE[(i + j) % CHART_PALETTE.length].replace('0.75', '1')),
        borderRadius: 4,
      }
    }),
  }
}

function AiChart({ chartType, chartData, chartTitle }) {
  if (!chartType || chartType === 'none' || !chartData) return null
  const data = applyPalette(chartData)
  return (
    <div className="card space-y-3">
      {chartTitle && <h3 className="text-sm font-semibold text-gray-300">{chartTitle}</h3>}
      <div style={{ height: 340 }}>
        {chartType === 'bar' && <Bar data={data} options={CHART_OPTS_BASE} />}
        {chartType === 'line' && <Line data={data} options={CHART_OPTS_BASE} />}
        {chartType === 'doughnut' && <Doughnut data={data} options={DOUGHNUT_OPTS} />}
      </div>
    </div>
  )
}

function AiTable({ tableHeaders, tableRows }) {
  if (!tableHeaders || !tableRows || tableRows.length === 0) return null
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-800">
            {tableHeaders.map(h => (
              <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row, i) => (
            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/20">
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-4 text-gray-300">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExportRow({ tableHeaders, tableRows, exportTitle }) {
  if (!tableHeaders || !tableRows || tableRows.length === 0) return null

  function handleExcelExport() {
    const columns = tableHeaders.map((_, i) => String(i))
    const rows = tableRows.map(row =>
      Object.fromEntries(tableHeaders.map((h, i) => [String(i), row[i] ?? '']))
    )
    exportToExcel(rows, columns, tableHeaders, exportTitle || 'ai-analytics')
  }

  function handlePdfExport() {
    const columns = tableHeaders.map((h, i) => ({ key: String(i), header: h }))
    const rows = tableRows.map(row =>
      Object.fromEntries(tableHeaders.map((h, i) => [String(i), row[i] ?? '']))
    )
    exportToPdf(rows, columns, exportTitle || 'Smart Analytics', exportTitle || 'smart-analytics')
  }

  return (
    <div className="flex gap-3">
      <button
        onClick={handleExcelExport}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-green-400 border border-green-700/40 hover:bg-green-900/20 transition-colors"
      >
        <Download size={13} />
        Export Excel
      </button>
      <button
        onClick={handlePdfExport}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-blue-400 border border-blue-700/40 hover:bg-blue-900/20 transition-colors"
      >
        <FileText size={13} />
        Export PDF
      </button>
    </div>
  )
}

function HistoryItem({ item }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <ChevronRight
          size={14}
          className={`text-gray-500 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="text-sm text-gray-400 truncate">{item.question}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-4 pt-3 border-t border-gray-800">
          {item.response.answer && (
            <p className="text-gray-300 text-sm">{item.response.answer}</p>
          )}
          {item.response.insights?.length > 0 && (
            <ul className="space-y-1">
              {item.response.insights.map((ins, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                  <span className="text-green-400 mt-0.5">•</span>
                  <span>{ins}</span>
                </li>
              ))}
            </ul>
          )}
          <AiChart
            chartType={item.response.chartType}
            chartData={item.response.chartData}
            chartTitle={item.response.chartTitle}
          />
          <AiTable
            tableHeaders={item.response.tableHeaders}
            tableRows={item.response.tableRows}
          />
        </div>
      )}
    </div>
  )
}

export default function AiAnalytics() {
  const { activeCountry } = useSettings()
  const [records, setRecords]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [question, setQuestion]     = useState('')
  const [asking, setAsking]         = useState(false)
  const [response, setResponse]     = useState(null)
  const [error, setError]           = useState(null)
  const [history, setHistory]       = useState([])

  const hasApiKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY

  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = supabase
        .from('tyre_records')
        .select('id,issue_date,brand,site,asset_no,category,risk_level,cost_per_tyre,qty,serial_no,created_at')
        .order('issue_date', { ascending: true })
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data } = await q
      setRecords(data || [])
      setLoading(false)
    }
    load()
  }, [activeCountry])

  const anomalies = useMemo(() => detectAnomalies(records), [records])
  const dataContext = useMemo(() => buildDataContext(records, anomalies), [records, anomalies])

  async function handleAsk() {
    if (!question.trim() || asking) return
    setAsking(true)
    setError(null)
    setResponse(null)
    try {
      const result = await askAI(question, dataContext)
      setResponse(result)
      setHistory(prev => [{ question, response: result }, ...prev].slice(0, 3))
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setAsking(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAsk()
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading data…</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Sparkles size={22} className="text-green-400" />
          Smart Analytics
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Ask questions in plain language · get charts, tables, and written insights powered by Smart Engine
        </p>
      </div>

      {/* API key warning */}
      {!hasApiKey && (
        <div className="rounded-lg p-4 border border-yellow-700/50 bg-yellow-900/15">
          <p className="text-yellow-300 text-sm font-semibold mb-1">API Key Required</p>
          <p className="text-yellow-400/80 text-sm">
            Smart Analytics features require an Analytics API key. Add{' '}
            <code className="bg-yellow-900/40 px-1 rounded text-yellow-300">VITE_ANALYTICS_API_KEY=your_key</code>{' '}
            to your <code className="bg-yellow-900/40 px-1 rounded text-yellow-300">.env.local</code> file.
            Get your API key from your analytics provider.
          </p>
        </div>
      )}

      {/* Data summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Records Loaded', value: records.length.toLocaleString(), color: 'text-green-400' },
          { label: 'Total Cost (SAR)', value: `SAR ${(dataContext.summary?.totalCost || 0).toLocaleString()}`, color: 'text-teal-400' },
          { label: 'Anomalies Found', value: anomalies.length.toLocaleString(), color: 'text-yellow-400' },
          { label: 'High Severity', value: anomalies.filter(a => a.severity === 'high').length.toLocaleString(), color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-gray-400 text-sm mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Suggested chips */}
      <div className="card space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Suggested questions</p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => setQuestion(q)}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-gray-300 border border-gray-700 hover:border-green-600/60 hover:text-green-400 hover:bg-green-900/10 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Question input */}
      <div className="card space-y-3">
        <textarea
          rows={2}
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your fleet data… (Ctrl+Enter to submit)"
          className="input w-full resize-none"
          disabled={asking}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-600">
            {records.length} records loaded {activeCountry !== 'All' ? `(${activeCountry})` : '(all countries)'}
          </p>
          <button
            onClick={handleAsk}
            disabled={!question.trim() || asking || !hasApiKey}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: asking ? '#166534' : '#15803d' }}
          >
            {asking ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Thinking…
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Ask
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg p-4 border border-red-700/50 bg-red-900/15">
          <p className="text-red-300 text-sm font-semibold mb-1">Error</p>
          <p className="text-red-400/80 text-sm">{error}</p>
        </div>
      )}

      {/* Response */}
      {response && (
        <div className="space-y-4">
          {/* Answer card */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-green-400">
              <Sparkles size={12} />
              Smart Analytics Response
            </div>

            {response.answer && (
              <p className="text-gray-200 text-sm leading-relaxed">{response.answer}</p>
            )}

            {response.insights?.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-gray-800">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Key Insights</p>
                <ul className="space-y-1">
                  {response.insights.map((ins, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-green-400 mt-0.5 flex-shrink-0">•</span>
                      <span>{ins}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Chart */}
          {response.chartType && response.chartType !== 'none' && response.chartData && (
            <AiChart
              chartType={response.chartType}
              chartData={response.chartData}
              chartTitle={response.chartTitle}
            />
          )}

          {/* Table */}
          {response.tableHeaders && response.tableRows && (
            <AiTable
              tableHeaders={response.tableHeaders}
              tableRows={response.tableRows}
            />
          )}

          {/* Export */}
          {response.tableHeaders && response.tableRows && (
            <ExportRow
              tableHeaders={response.tableHeaders}
              tableRows={response.tableRows}
              exportTitle={response.exportTitle}
            />
          )}
        </div>
      )}

      {/* Conversation history */}
      {history.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Previous Questions</p>
          {history.map((item, i) => (
            <HistoryItem key={i} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
