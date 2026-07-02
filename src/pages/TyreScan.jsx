import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ScanLine, History, Clock, Trash2, CheckCircle, AlertCircle, ChevronRight } from 'lucide-react'
import TyreScanCamera from '../components/TyreScanCamera'
import { useNavigate } from 'react-router-dom'

const HISTORY_KEY = 'tp_scan_history'
const MAX_HISTORY = 25

const RISK_STYLE = {
  Critical: { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)',  text: '#f87171' },
  High:     { bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)', text: '#fb923c' },
  Medium:   { bg: 'rgba(234,179,8,0.08)',  border: 'rgba(234,179,8,0.25)',  text: '#facc15' },
  Low:      { bg: 'rgba(22,163,74,0.08)',  border: 'rgba(22,163,74,0.25)',  text: '#4ade80' },
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') }
  catch { return [] }
}

function saveHistory(entry, existing) {
  const filtered = existing.filter(h => h.serial !== entry.serial)
  const updated  = [entry, ...filtered].slice(0, MAX_HISTORY)
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)) } catch {}
  return updated
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function TyreScan() {
  const navigate              = useNavigate()
  const [scanOpen, setScanOpen] = useState(false)
  const [history, setHistory] = useState(loadHistory)
  const [, tick]              = useState(0)

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
    setHistory(prev => saveHistory(entry, prev))
  }

  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY) } catch {}
    setHistory([])
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      <div className="p-4 flex flex-col gap-4">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-white leading-tight">Tyre Scanner</h1>
            <p className="text-xs text-gray-500 mt-0.5">Scan barcodes, QR codes, or enter manually</p>
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
            <p className="text-base font-bold text-white">Tap to Scan</p>
            <p className="text-xs text-gray-500 mt-1">Barcode · QR Code · Manual entry</p>
          </div>
        </motion.button>

        {/* Feature chips */}
        <div className="flex gap-2">
          {['Auto-detect barcode', 'QR Code', 'Manual fallback'].map(f => (
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
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Recent Scans</span>
            </div>
            <button
              onClick={clearHistory}
              className="flex items-center gap-1 text-[10px] text-gray-700 hover:text-red-400 transition-colors py-1 px-2 rounded-lg hover:bg-red-500/10"
            >
              <Trash2 className="w-3 h-3" /> Clear all
            </button>
          </div>

          <AnimatePresence initial={false}>
            {history.map((entry, i) => {
              const rs = entry.risk ? RISK_STYLE[entry.risk] : null
              return (
                <motion.div
                  key={entry.serial + entry.scannedAt}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-3 p-3.5 rounded-2xl"
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
                        : 'Not found in database'}
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
                      <span className="text-[9px] text-gray-700">{relativeTime(entry.scannedAt)}</span>
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
            View all tyre records <ChevronRight className="w-3.5 h-3.5" />
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
          <p className="text-sm font-semibold text-gray-600">No scans yet</p>
          <p className="text-xs text-gray-700">Scanned serials will appear here</p>
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
