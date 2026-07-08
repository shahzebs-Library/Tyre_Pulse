import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { motion, AnimatePresence } from 'framer-motion'
import {
  QrCode, Printer, Download, Search, CircleDot, Truck,
  CheckSquare, Square, RefreshCw, Check, Info, X,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'

const LABEL_SIZES = {
  sm: { label: 'Small',  dim: 140, desc: '40 mm' },
  md: { label: 'Medium', dim: 180, desc: '55 mm' },
  lg: { label: 'Large',  dim: 220, desc: '70 mm' },
}

const PRINT_LABEL_W  = 60   // mm
const PRINT_LABEL_H  = 68   // mm
const PRINT_COLS     = 3
const PRINT_ROWS_PP  = 4    // rows per page

// ── QR generation helper ──────────────────────────────────────────────────────
async function makeQR(value) {
  return QRCode.toDataURL(value, {
    width: 400, margin: 1, errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })
}

export default function QrLabels() {
  const { profile } = useAuth()

  const [mode,       setMode]       = useState('tyres')  // 'tyres' | 'assets'
  const [data,       setData]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [sites,      setSites]      = useState([])
  const [selected,   setSelected]   = useState(new Set())
  const [search,     setSearch]     = useState('')
  const [filterSite, setFilterSite] = useState('all')
  const [labelSize,  setLabelSize]  = useState('md')
  const [qrImages,   setQrImages]   = useState({})       // { id → dataURL }
  const [generating, setGenerating] = useState(false)
  const [exporting,  setExporting]  = useState(false)
  const printAreaRef = useRef(null)

  useEffect(() => {
    setSelected(new Set())
    setQrImages({})
    setSearch('')
    setFilterSite('all')
    loadData()
  }, [mode])

  async function loadData() {
    setLoading(true)
    if (mode === 'tyres') {
      const { data: rows } = await supabase
        .from('tyre_records')
        .select('id, serial_number, brand, site, asset_no, risk_level')
        .order('asset_no')
        .limit(1000)
      setData(rows || [])
      setSites([...new Set((rows || []).map(r => r.site).filter(Boolean))].sort())
    } else {
      const { data: rows } = await supabase
        .from('vehicle_fleet')
        .select('id, asset_no, vehicle_type, site')
        .not('asset_no', 'is', null)
        .order('asset_no')
        .limit(1000)
      setData(rows || [])
      setSites([...new Set((rows || []).map(r => r.site).filter(Boolean))].sort())
    }
    setLoading(false)
  }

  const filtered = data.filter(r => {
    const val = mode === 'tyres' ? r.serial_number : r.asset_no
    const q   = search.toLowerCase()
    const matchSearch = !q
      || val?.toLowerCase().includes(q)
      || r.brand?.toLowerCase().includes(q)
      || r.site?.toLowerCase().includes(q)
      || r.vehicle_type?.toLowerCase().includes(q)
    const matchSite = filterSite === 'all' || r.site === filterSite
    return matchSearch && matchSite
  })

  function getLabel(item) { return mode === 'tyres' ? (item.serial_number ?? item.asset_no ?? String(item.id)) : item.asset_no }
  function getSub(item)   {
    return mode === 'tyres'
      ? [item.brand, item.site].filter(Boolean).join(' · ')
      : [item.vehicle_type, item.site].filter(Boolean).join(' · ')
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected(prev =>
      prev.size === filtered.length && filtered.length > 0
        ? new Set()
        : new Set(filtered.map(r => r.id))
    )
  }

  async function handleGenerate() {
    setGenerating(true)
    const items = filtered.filter(r => selected.has(r.id))
    const results = {}
    await Promise.all(items.map(async item => {
      const val = getLabel(item)
      if (val) {
        try { results[item.id] = await makeQR(val) } catch { /* skip */ }
      }
    }))
    setQrImages(prev => ({ ...prev, ...results }))
    setGenerating(false)
  }

  function handlePrint() {
    window.print()
  }

  async function exportPDF() {
    const { default: jsPDF } = await import('jspdf')
    const readyItems = filtered.filter(r => selected.has(r.id) && qrImages[r.id])
    if (!readyItems.length) return
    setExporting(true)

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pw = 210
    const marginX = (pw - PRINT_COLS * PRINT_LABEL_W - (PRINT_COLS - 1) * 5) / 2
    const marginY = 12
    const gapX = 5, gapY = 5
    const perPage = PRINT_COLS * PRINT_ROWS_PP

    readyItems.forEach((item, idx) => {
      const pagePos = idx % perPage
      const col     = pagePos % PRINT_COLS
      const row     = Math.floor(pagePos / PRINT_COLS)

      if (idx > 0 && pagePos === 0) doc.addPage()

      const x   = marginX + col * (PRINT_LABEL_W + gapX)
      const y   = marginY + row * (PRINT_LABEL_H + gapY)
      const val = getLabel(item)
      const sub = getSub(item)

      // ── Border ──────────────────────────────────────────────────────────
      doc.setDrawColor(22, 163, 74)
      doc.setLineWidth(0.5)
      doc.roundedRect(x, y, PRINT_LABEL_W, PRINT_LABEL_H, 2, 2)

      // ── Header bar ──────────────────────────────────────────────────────
      doc.setFillColor(22, 163, 74)
      doc.roundedRect(x, y, PRINT_LABEL_W, 6, 2, 2)
      doc.rect(x, y + 3, PRINT_LABEL_W, 3, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(5.5)
      doc.setFont('helvetica', 'bold')
      doc.text('TYREPULSE', x + PRINT_LABEL_W / 2, y + 4.2, { align: 'center' })

      // ── QR code image ────────────────────────────────────────────────────
      const qrPad  = 8
      const qrSize = PRINT_LABEL_W - qrPad * 2
      doc.addImage(qrImages[item.id], 'PNG', x + qrPad, y + 8, qrSize, qrSize)

      // ── Serial / Asset number ────────────────────────────────────────────
      doc.setTextColor(0, 0, 0)
      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'bold')
      doc.text(val || '', x + PRINT_LABEL_W / 2, y + PRINT_LABEL_H - 7, { align: 'center' })

      // ── Secondary info ───────────────────────────────────────────────────
      if (sub) {
        doc.setFontSize(5.5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(100, 100, 100)
        doc.text(sub, x + PRINT_LABEL_W / 2, y + PRINT_LABEL_H - 2.5, { align: 'center' })
      }
    })

    doc.save(`TyrePulse_QR_${mode}_${new Date().toISOString().split('T')[0]}.pdf`)
    setExporting(false)
  }

  const selectedItems  = filtered.filter(r => selected.has(r.id))
  const readyItems     = selectedItems.filter(r => qrImages[r.id])
  const pendingItems   = selectedItems.filter(r => !qrImages[r.id])
  const dim            = LABEL_SIZES[labelSize].dim

  return (
    <>
      {/* ── Print styles ─────────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          body > * { visibility: hidden !important; }
          #tp-qr-print, #tp-qr-print * { visibility: visible !important; }
          #tp-qr-print {
            position: fixed !important;
            top: 0 !important; left: 0 !important;
            width: 210mm !important;
            padding: 10mm !important;
            background: white !important;
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 4mm !important;
            align-content: flex-start !important;
          }
          .tp-print-label {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            width: 60mm !important;
            border: 1.5px solid #16a34a !important;
            border-radius: 3mm !important;
            overflow: hidden !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            background: white !important;
          }
          .tp-print-header {
            width: 100% !important; background: #16a34a !important;
            text-align: center !important; padding: 2mm 0 !important;
          }
          .tp-print-header span { color: white !important; font-size: 7pt !important; font-weight: bold !important; font-family: Arial, sans-serif !important; }
          .tp-print-qr { width: 50mm !important; height: 50mm !important; margin: 2mm !important; }
          .tp-print-serial { font-family: monospace !important; font-size: 8pt !important; font-weight: bold !important; text-align: center !important; color: #000 !important; margin-bottom: 1mm !important; }
          .tp-print-sub { font-size: 6pt !important; color: #666 !important; text-align: center !important; padding-bottom: 2mm !important; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      {/* ── Print area (always rendered, off-screen until printing) ──────────── */}
      <div
        id="tp-qr-print"
        ref={printAreaRef}
        style={{ position: 'fixed', top: 0, left: '-99999px', width: '210mm', background: 'white' }}
        aria-hidden
      >
        {readyItems.map(item => (
          <div key={item.id} className="tp-print-label">
            <div className="tp-print-header"><span>TYREPULSE</span></div>
            <img src={qrImages[item.id]} alt="" className="tp-print-qr" />
            <p className="tp-print-serial">{getLabel(item)}</p>
            {getSub(item) && <p className="tp-print-sub">{getSub(item)}</p>}
          </div>
        ))}
      </div>

      {/* ── Page ─────────────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <PageHeader
          title="QR Label Generator"
          subtitle="Auto-generate QR code labels for tyres and vehicles - print and stick on assets"
          icon={QrCode}
          actions={
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handlePrint}
                disabled={readyItems.length === 0}
                className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-40"
              >
                <Printer size={14} /> Print Labels
              </button>
              <button
                onClick={exportPDF}
                disabled={readyItems.length === 0 || exporting}
                className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-40"
              >
                <Download size={14} />
                {exporting ? 'Exporting...' : `Export PDF${readyItems.length > 0 ? ` (${readyItems.length})` : ''}`}
              </button>
            </div>
          }
        />

        {/* ── Controls row ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Mode */}
          <div className="flex p-1 rounded-lg gap-1" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {[
              { key: 'tyres',  icon: CircleDot, label: 'Tyre Serials' },
              { key: 'assets', icon: Truck,     label: 'Vehicle Assets' },
            ].map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  mode === key
                    ? 'text-green-300'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                style={mode === key ? {
                  background: 'rgba(22,163,74,0.16)',
                  border: '1px solid rgba(22,163,74,0.3)',
                } : { border: '1px solid transparent' }}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          {/* Label size */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Label size:</span>
            <div className="flex p-0.5 rounded-lg gap-0.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              {Object.entries(LABEL_SIZES).map(([key, { label, desc }]) => (
                <button
                  key={key}
                  onClick={() => setLabelSize(key)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    labelSize === key
                      ? 'bg-green-600 text-white shadow'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {label} <span className="opacity-60">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Generate button - right side */}
          {selected.size > 0 && (
            <div className="flex items-center gap-3 ml-auto">
              <span className="text-xs text-gray-500">{selected.size} selected</span>
              {pendingItems.length > 0 && (
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
                  style={{ boxShadow: generating ? 'none' : '0 0 20px rgba(22,163,74,0.35)' }}
                >
                  {generating
                    ? <><RefreshCw size={13} className="animate-spin" /> Generating...</>
                    : <><QrCode size={13} /> Generate {pendingItems.length} QR{pendingItems.length !== 1 ? 's' : ''}</>
                  }
                </button>
              )}
              {readyItems.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <Check size={12} /> {readyItems.length} ready
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Filters ──────────────────────────────────────────────────────────── */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-52">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              className="input pl-8 text-sm"
              placeholder={mode === 'tyres' ? 'Search serial, brand, site...' : 'Search asset, type, site...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input w-44 text-sm" value={filterSite} onChange={e => setFilterSite(e.target.value)}>
            <option value="all">All Sites</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            onClick={toggleAll}
            className="btn-secondary text-sm px-4"
          >
            {selected.size === filtered.length && filtered.length > 0 ? 'Deselect All' : `Select All (${filtered.length})`}
          </button>
        </div>

        {/* ── Generated QR preview grid ─────────────────────────────────────────── */}
        <AnimatePresence>
          {readyItems.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <QrCode size={13} className="text-green-400" />
                  Label Preview - {readyItems.length} generated
                </h3>
                <span className="text-xs text-gray-600">Print-ready · {LABEL_SIZES[labelSize].desc} labels</span>
              </div>

              <div className="flex flex-wrap gap-3">
                {readyItems.map(item => {
                  const val = getLabel(item)
                  const sub = getSub(item)
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, scale: 0.88 }}
                      animate={{ opacity: 1, scale: 1 }}
                      style={{ width: dim }}
                    >
                      {/* Label card */}
                      <div
                        className="flex flex-col rounded-xl overflow-hidden"
                        style={{
                          border: '1.5px solid rgba(22,163,74,0.45)',
                          boxShadow: '0 0 24px rgba(22,163,74,0.1), 0 4px 16px rgba(0,0,0,0.4)',
                        }}
                      >
                        {/* Green header */}
                        <div
                          className="py-1.5 text-center text-[9px] font-black tracking-[0.18em] uppercase text-white"
                          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}
                        >
                          TYREPULSE
                        </div>

                        {/* QR image - white background so codes are scannable */}
                        <div className="flex items-center justify-center p-2 bg-white">
                          <img
                            src={qrImages[item.id]}
                            alt={val}
                            style={{ width: dim - 20, height: dim - 20, display: 'block' }}
                          />
                        </div>

                        {/* Serial / info */}
                        <div
                          className="px-2 pt-1.5 pb-2 text-center"
                          style={{ background: 'var(--panel-deep)' }}
                        >
                          <p className="text-[11px] font-bold font-mono text-white tracking-tight truncate">{val}</p>
                          {sub && (
                            <p className="text-[8.5px] text-gray-500 truncate mt-0.5">{sub}</p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Records table ────────────────────────────────────────────────────── */}
        <div className="card overflow-hidden p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500 text-sm">Loading records...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-xs text-gray-500 font-semibold uppercase tracking-wider"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={selected.size === filtered.length && filtered.length > 0}
                        onChange={toggleAll}
                        className="w-4 h-4 rounded accent-green-500 cursor-pointer"
                      />
                    </th>
                    <th className="px-3 py-3">{mode === 'tyres' ? 'Serial No' : 'Asset No'}</th>
                    {mode === 'tyres'  && <th className="px-3 py-3">Brand</th>}
                    {mode === 'assets' && <th className="px-3 py-3">Vehicle Type</th>}
                    <th className="px-3 py-3">Site</th>
                    {mode === 'tyres' && <th className="px-3 py-3">Status</th>}
                    <th className="px-3 py-3">QR</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => {
                    const val    = getLabel(item)
                    const isSelected = selected.has(item.id)
                    const hasQr  = !!qrImages[item.id]
                    return (
                      <tr
                        key={item.id}
                        onClick={() => toggleSelect(item.id)}
                        className="cursor-pointer transition-colors"
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          background: isSelected ? 'rgba(22,163,74,0.07)' : undefined,
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(22,163,74,0.07)' : '' }}
                      >
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            onClick={e => e.stopPropagation()}
                            className="w-4 h-4 rounded accent-green-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-white">{val || '-'}</td>
                        {mode === 'tyres'  && <td className="px-3 py-2.5 text-gray-300 text-xs">{item.brand || '-'}</td>}
                        {mode === 'assets' && <td className="px-3 py-2.5 text-gray-300 text-xs">{item.vehicle_type || '-'}</td>}
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{item.site || '-'}</td>
                        {mode === 'tyres' && (
                          <td className="px-3 py-2.5">
                            {item.risk_level && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800/80 text-gray-400 border border-gray-700/50">
                                {item.risk_level}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2.5">
                          {hasQr ? (
                            <span className="flex items-center gap-1 text-xs text-green-400">
                              <Check size={11} /> Ready
                            </span>
                          ) : isSelected ? (
                            <span className="text-xs text-yellow-500">Pending</span>
                          ) : (
                            <span className="text-xs text-gray-700">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-14 text-center text-gray-600 text-sm">
                        No records found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── How-to card ──────────────────────────────────────────────────────── */}
        <div
          className="card space-y-2"
          style={{ background: 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.12)' }}
        >
          <h3 className="text-sm font-semibold text-green-400 flex items-center gap-2">
            <Info size={13} /> How to use
          </h3>
          <ol className="space-y-1 text-xs text-gray-500 list-decimal list-inside leading-relaxed">
            <li>Choose <strong className="text-gray-400">Tyre Serials</strong> (serial-level labels) or <strong className="text-gray-400">Vehicle Assets</strong> (vehicle-level labels)</li>
            <li>Tick the rows you want - or use <strong className="text-gray-400">Select All</strong></li>
            <li>Click <strong className="text-gray-400">Generate QRs</strong> - a live preview appears above the table</li>
            <li>
              <strong className="text-gray-400">Print Labels</strong> opens the browser print dialog - print on A4 label sheets
              (3 × 4 = 12 per page). Or use <strong className="text-gray-400">Export PDF</strong> for a ready-to-send file.
            </li>
            <li>Cut and stick labels onto the tyre or vehicle windscreen / chassis plate</li>
            <li>Scan with the <strong className="text-gray-400">TyrePulse Scanner</strong> to instantly pull up full tyre details</li>
          </ol>
        </div>
      </div>
    </>
  )
}
