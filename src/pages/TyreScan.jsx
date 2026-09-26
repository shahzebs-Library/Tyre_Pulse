import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ScanLine, History, Clock, Trash2, CheckCircle, AlertCircle, ChevronRight, FileSpreadsheet, FileText } from 'lucide-react'
import TyreScanCamera from '../components/TyreScanCamera'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import { normaliseHistory, scanKpis, riskBreakdown, filterScans, sortScans, passportPath, scanExportRows } from '../lib/tyreScanAnalytics'
import { toUserMessage } from '../lib/safeError'

const EXPORT_COLS = ['serial', 'outcome', 'brand', 'asset', 'site', 'risk', 'tread', 'scanned_at']
const EXPORT_HEADERS = ['Serial', 'Outcome', 'Brand', 'Asset', 'Site', 'Risk', 'Tread', 'Scanned at']

const HISTORY_KEY = 'tp_scan_history'
const MAX_HISTORY = 200

const RISK_STYLE = {
  Critical: { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)',  text: '#f87171' },
  High:     { bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)', text: '#fb923c' },
  Medium:   { bg: 'rgba(234,179,8,0.08)',  border: 'rgba(234,179,8,0.25)',  text: '#facc15' },
  Low:      { bg: 'rgba(22,163,74,0.08)',  border: 'rgba(22,163,74,0.25)',  text: '#4ade80' },
}

function loadHistory() {
  try { return normaliseHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')) }
  catch { return [] }
}

function saveHistory(entry, existing) {
  const filtered = existing.filter(h => h.serial !== entry.serial)
  const updated  = [entry, ...filtered].slice(0, MAX_HISTORY)
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)) } catch {}
  return updated
}

function relativeTime(iso, t) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return t('scan.time.justNow')
  if (m < 60) return t('scan.time.minutes', { m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('scan.time.hours', { h })
  return t('scan.time.days', { d: Math.floor(h / 24) })
}

export default function TyreScan() {
  const { t }                 = useLanguage()
  const navigate              = useNavigate()
  const [scanOpen, setScanOpen] = useState(false)
  const [history, setHistory] = useState(loadHistory)
  const [, tick]              = useState(0)
  const [outcome, setOutcome] = useState('all')
  const [risk, setRisk]       = useState('all')
  const [search, setSearch]   = useState('')
  const [sort, setSort]       = useState('newest')
  const [exportError, setExportError] = useState('')
  const kpis    = useMemo(() => scanKpis(history), [history])
  const risks   = useMemo(() => riskBreakdown(history), [history])
  const shown   = useMemo(() => sortScans(filterScans(history, { outcome, risk, search }), sort), [history, outcome, risk, search, sort])
  const failed  = useMemo(() => history.filter(e => !e.found), [history])

  async function doExport(kind) {
    setExportError('')
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await import('../lib/exportUtils')
      const rows = scanExportRows(shown); const name = reportFileName('Tyre Scan History')
      if (kind === 'excel') await exportToExcel(rows, EXPORT_COLS, EXPORT_HEADERS, name)
      else await exportToPdf(rows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tyre Scan History', name, 'landscape')
    } catch (err) { setExportError(toUserMessage(err, 'The export could not be created.')) }
  }

  // Refresh relative timestamps every minute
  useEffect(() => {
    const iv = setInterval(() => tick(n => n + 1), 60_000)
    return () => clearInterval(iv)
  }, [])

  function handleScanResult(result) {
    const entry = {
      serial:    result.serial,
      brand:     result.tyre?.brand     ?? '-',
      asset:     result.tyre?.asset_no  ?? '-',
      site:      result.tyre?.site      ?? '-',
      risk:      result.tyre?.risk_level ?? null,
      status:    result.tyre?.status    ?? null,
      tread:     result.tyre?.tread_depth != null ? `${result.tyre.tread_depth} mm` : null,
      found:     !!result.tyre,
      scannedAt: new Date().toISOString(),
    }
    setHistory(prev => normaliseHistory(saveHistory(entry, prev)))
  }

  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY) } catch {}
    setHistory([])
  }

  return (
    <div className="flex flex-col space-y-6" style={{ background: 'var(--bg-base)' }}>
      <div className="p-4 flex flex-col gap-4">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-white leading-tight">{t('scan.title')}</h1>
            <p className="text-xs text-gray-500 mt-0.5">{t('scan.subtitle')}</p>
          </div>
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(22,163,74,0.18), rgba(22,163,74,0.06))',
              border: '1px solid rgba(22,163,74,0.3)',
              boxShadow: '0 0 24px rgba(22,163,74,0.12)',
            }}
          >
            <ScanLine className="w-5 h-5 text-green-400" />
          </div>
        </div>

        {/* Big scan button */}
        <motion.button
          onClick={() => setScanOpen(true)}
          className="w-full py-7 rounded-2xl flex flex-col items-center gap-4 active:opacity-80 transition-opacity"
          style={{
            background: 'linear-gradient(135deg, rgba(22,163,74,0.14) 0%, rgba(22,163,74,0.06) 100%)',
            border: '1px solid rgba(22,163,74,0.3)',
            boxShadow: '0 0 40px rgba(22,163,74,0.12)',
          }}
          whileTap={{ scale: 0.98 }}
        >
          <motion.div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              boxShadow: '0 0 30px rgba(22,163,74,0.55)',
            }}
            animate={{ boxShadow: ['0 0 30px rgba(22,163,74,0.55)', '0 0 50px rgba(22,163,74,0.75)', '0 0 30px rgba(22,163,74,0.55)'] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ScanLine className="w-9 h-9 text-white" />
          </motion.div>
          <div className="text-center">
            <p className="text-base font-bold text-white">{t('scan.tapToScan')}</p>
            <p className="text-xs text-gray-500 mt-1">{t('scan.modes')}</p>
          </div>
        </motion.button>

        {/* Feature chips */}
        <div className="flex gap-2">
          {[t('scan.chips.autoDetect'), t('scan.chips.qr'), t('scan.chips.manual')].map(f => (
            <span
              key={f}
              className="flex-1 text-center text-[9.5px] font-semibold py-1.5 rounded-lg"
              style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.12)', color: '#6b7280' }}
            >
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Scan history */}
      {history.length > 0 && (
        <div className="px-4 pb-6 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t('scan.recentScans')}</span>
            </div>
            <button
              onClick={clearHistory}
              className="flex items-center gap-1 text-[10px] text-gray-700 hover:text-red-400 transition-colors py-1 px-2 rounded-lg hover:bg-red-500/10"
            >
              <Trash2 className="w-3 h-3" /> {t('scan.clearAll')}
            </button>
          </div>

          <p className="text-[11px] text-gray-500">This history is kept on this device only and holds your last {MAX_HISTORY} distinct scans. Tap a found tyre to open its passport.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            {[['Scans', kpis.total], ['Found', kpis.found], ['Not found', kpis.notFound], ['Found rate', kpis.foundRate == null ? 'N/A' : `${kpis.foundRate}%`], ['High or critical', kpis.atRisk], ['Vehicles', kpis.assets]].map(([label, value]) => (
              <div key={label} className="card py-2 px-3"><p className="text-[10px] text-gray-500">{label}</p><p className="text-lg font-bold text-[var(--text-primary)]">{value}</p></div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {Object.entries(risks).map(([k, v]) => <span key={k} className="px-2 py-1 rounded-lg border border-[var(--input-border)] text-[var(--text-secondary)]">{k}: {v}</span>)}
          </div>
          {failed.length > 0 && (
            <div className="card py-2 px-3">
              <p className="text-xs font-semibold text-amber-500">Failed lookups ({failed.length})</p>
              <p className="text-[11px] text-gray-500 mb-1">These serials were not found in tyre records. Check the serial or register the tyre.</p>
              <div className="flex flex-wrap gap-1.5">{failed.slice(0, 30).map(e => <button key={e.serial + e.scannedAt} onClick={() => navigate(passportPath(e.serial))} className="font-mono text-[11px] px-2 py-0.5 rounded border border-amber-500/30 text-amber-500">{e.serial}</button>)}</div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input className="input flex-1 min-w-[160px]" aria-label="Search scans" placeholder="Search serial, brand, vehicle, site" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="input" aria-label="Scan outcome" value={outcome} onChange={e => setOutcome(e.target.value)}><option value="all">All outcomes</option><option value="found">Found</option><option value="not_found">Not found</option></select>
            <select className="input" aria-label="Risk" value={risk} onChange={e => setRisk(e.target.value)}><option value="all">Any risk</option>{Object.keys(risks).map(k => <option key={k} value={k}>{k}</option>)}</select>
            <select className="input" aria-label="Sort scans" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="risk">Highest risk</option><option value="serial">Serial</option></select>
            <button className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => doExport('excel')} disabled={!shown.length}><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
            <button className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => doExport('pdf')} disabled={!shown.length}><FileText className="w-3.5 h-3.5" /> PDF</button>
          </div>
          {exportError && <p className="text-xs text-red-500">{exportError}</p>}
          {!shown.length && <p className="text-xs text-gray-500 text-center py-4">No scans match these filters.</p>}

          <AnimatePresence initial={false}>
            {shown.map((entry, i) => {
              const rs = entry.risk ? RISK_STYLE[entry.risk] : null
              return (
                <motion.div
                  key={entry.serial + entry.scannedAt}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(passportPath(entry.serial))}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(passportPath(entry.serial)) } }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: Math.min(i, 10) * 0.03 }}
                  className="flex items-center gap-3 p-3.5 rounded-2xl cursor-pointer"
                  style={{
                    background: rs?.bg ?? 'rgba(255,255,255,0.03)',
                    border: `1px solid ${rs?.border ?? 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  {entry.found
                    ? <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    : <AlertCircle className="w-4 h-4 text-gray-600 flex-shrink-0" />}

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white font-mono truncate">{entry.serial}</p>
                    <p className="text-[10px] text-gray-500 truncate mt-0.5">
                      {entry.found
                        ? [entry.brand, entry.asset, entry.site].filter(v => v && v !== '-').join(' · ')
                        : t('scan.notFound')}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {entry.risk && rs && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: rs.bg, border: `1px solid ${rs.border}`, color: rs.text }}
                      >
                        {entry.risk}
                      </span>
                    )}
                    <div className="flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5 text-gray-700" />
                      <span className="text-[9px] text-gray-700">{relativeTime(entry.scannedAt, t)}</span>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>

          {/* Link to full tyre records */}
          <button
            onClick={() => navigate('/tyres')}
            className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-300 transition-colors"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            {t('scan.viewAll')} <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Empty state */}
      {history.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-3 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center opacity-30"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <History className="w-7 h-7 text-gray-400" />
          </div>
          <p className="text-sm font-semibold text-gray-600">{t('scan.empty.title')}</p>
          <p className="text-xs text-gray-700">{t('scan.empty.subtitle')}</p>
        </div>
      )}

      {/* Scanner modal */}
      <AnimatePresence>
        {scanOpen && (
          <TyreScanCamera
            onClose={() => setScanOpen(false)}
            onResult={handleScanResult}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
