import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  X, Camera, Keyboard, CheckCircle, AlertCircle, Loader2, Search,
  RefreshCw, ClipboardCheck,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

function barcodeDetectorSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

const RISK_STYLE = {
  Critical: { bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.35)',  text: '#f87171' },
  High:     { bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.35)', text: '#fb923c' },
  Medium:   { bg: 'rgba(234,179,8,0.12)',   border: 'rgba(234,179,8,0.35)',  text: '#facc15' },
  Low:      { bg: 'rgba(22,163,74,0.12)',   border: 'rgba(22,163,74,0.35)',  text: '#4ade80' },
}

export default function TyreScanCamera({ onClose, onResult }) {
  const navigate = useNavigate()
  const [mode, setMode]       = useState('camera')
  const [scanning, setScanning] = useState(false)
  const [error, setError]     = useState(null)
  const [result, setResult]   = useState(null)
  const [manualSerial, setManualSerial] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasBarcodeApi]       = useState(barcodeDetectorSupported)

  const videoRef     = useRef(null)
  const streamRef    = useRef(null)
  const intervalRef  = useRef(null)
  const canvasRef    = useRef(null)
  const detectorRef  = useRef(null)

  const stopCamera = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const lookupSerial = useCallback(async (raw) => {
    const serial = (raw || '').trim()
    if (!serial) return
    stopCamera()
    setScanning(false)
    setLoading(true)
    try {
      // Primary: tyre serial lookup
      const { data: tyreData } = await supabase
        .from('tyre_records')
        .select('id,serial_no,asset_no,brand,site,status,tread_depth,pressure,risk_level,cost')
        .ilike('serial_no', serial)
        .limit(1)
        .maybeSingle()

      if (tyreData) {
        setResult({ serial, tyre: tyreData, fleet: null })
      } else {
        // Secondary: asset/vehicle QR lookup — try asset_no and registration_no
        const { data: fleetData } = await supabase
          .from('vehicle_fleet')
          .select('asset_no,vehicle_type,site,registration_no')
          .or(`asset_no.ilike.${serial},registration_no.ilike.${serial}`)
          .limit(1)
          .maybeSingle()
        setResult({ serial, tyre: null, fleet: fleetData ?? null })
      }
    } catch {
      setResult({ serial, tyre: null, fleet: null })
    } finally {
      setLoading(false)
    }
  }, [stopCamera])

  const startCamera = useCallback(async () => {
    setError(null)
    setResult(null)
    setScanning(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      if (hasBarcodeApi) {
        detectorRef.current = new window.BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'data_matrix'],
        })
        if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
        const ctx = canvasRef.current.getContext('2d')

        intervalRef.current = setInterval(async () => {
          const vid = videoRef.current
          if (!vid || vid.readyState < 2 || !streamRef.current) return
          canvasRef.current.width  = vid.videoWidth
          canvasRef.current.height = vid.videoHeight
          ctx.drawImage(vid, 0, 0)
          try {
            const codes = await detectorRef.current.detect(canvasRef.current)
            if (codes.length > 0) {
              clearInterval(intervalRef.current)
              lookupSerial(codes[0].rawValue)
            }
          } catch { /* ignore individual frame errors */ }
        }, 200)
      }
    } catch (err) {
      setScanning(false)
      setError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access in your browser settings.'
          : 'Unable to access camera. Use manual entry below.',
      )
    }
  }, [hasBarcodeApi, lookupSerial])

  useEffect(() => {
    if (mode === 'camera') startCamera()
    return stopCamera
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopCamera(), [stopCamera])

  function handleFileCapture(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!hasBarcodeApi) {
      setError('Barcode detection not supported on this device. Use manual entry.')
      return
    }
    const img = new Image()
    const url  = URL.createObjectURL(file)
    img.onload = async () => {
      try {
        const det     = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] })
        const codes   = await det.detect(img)
        if (codes.length > 0) lookupSerial(codes[0].rawValue)
        else setError('No barcode found in the captured image. Try again or use manual entry.')
      } catch {
        setError('Could not read barcode. Try again or use manual entry.')
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.src = url
  }

  async function handleManualSubmit(e) {
    e.preventDefault()
    await lookupSerial(manualSerial)
  }

  function handleUse() {
    onResult?.(result)
    onClose?.()
  }

  function resetScan() {
    setResult(null)
    setError(null)
    setManualSerial('')
    if (mode === 'camera') startCamera()
    else setScanning(false)
  }

  function switchMode(m) {
    stopCamera()
    setScanning(false)
    setResult(null)
    setError(null)
    setManualSerial('')
    setMode(m)
  }

  const riskStyle = result?.tyre?.risk_level ? RISK_STYLE[result.tyre.risk_level] : null

  function handleStartChecklist() {
    stopCamera()
    onClose?.()
    navigate(`/inspections?asset=${encodeURIComponent(result.serial)}`)
  }

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: 'rgba(2,6,4,0.99)', touchAction: 'none' }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(22,163,74,0.15)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.3)' }}
          >
            <Camera className="w-4.5 h-4.5 text-green-400" style={{ width: 18, height: 18 }} />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">Tyre Scanner</p>
            <p className="text-[10px] text-gray-500">Scan barcode · QR code · manual entry</p>
          </div>
        </div>
        <button
          onClick={() => { stopCamera(); onClose?.() }}
          className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-500 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
          aria-label="Close scanner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode switcher */}
      <div className="flex gap-2 px-4 pt-3 pb-1 flex-shrink-0">
        {[
          { id: 'camera', label: 'Camera', Icon: Camera },
          { id: 'manual', label: 'Manual',  Icon: Keyboard },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => switchMode(id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
            style={mode === id
              ? { background: 'rgba(22,163,74,0.14)', border: '1px solid rgba(22,163,74,0.35)', color: '#4ade80' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#6b7280' }}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-2 flex flex-col gap-4">

        {/* ── Camera view ─────────────────────────────────────────────────── */}
        {mode === 'camera' && !result && !loading && (
          <div className="flex flex-col gap-3">
            <div
              className="relative rounded-2xl overflow-hidden w-full bg-black"
              style={{
                aspectRatio: '4/3',
                border: '1px solid rgba(22,163,74,0.2)',
                boxShadow: '0 0 40px rgba(0,0,0,0.6)',
              }}
            >
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />

              {scanning && !error && (
                <>
                  {/* Corner guides */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="relative" style={{ width: 200, height: 200 }}>
                      {[['top-0 left-0 border-t-2 border-l-2 rounded-tl-lg'],
                        ['top-0 right-0 border-t-2 border-r-2 rounded-tr-lg'],
                        ['bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg'],
                        ['bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg'],
                      ].map(([cls], i) => (
                        <div key={i} className={`absolute w-7 h-7 ${cls}`} style={{ borderColor: '#4ade80' }} />
                      ))}

                      {/* Animated scan line */}
                      <motion.div
                        className="absolute left-0 right-0 h-0.5"
                        style={{ background: 'linear-gradient(90deg, transparent, #4ade80, transparent)' }}
                        animate={{ top: ['15%', '85%', '15%'] }}
                        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    </div>
                  </div>
                  <p className="absolute bottom-3 inset-x-0 text-center text-[11px] text-green-400 font-semibold">
                    {hasBarcodeApi ? 'Point at barcode or QR code' : 'Capture image to scan'}
                  </p>
                </>
              )}

              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
                  <AlertCircle className="w-10 h-10 text-red-400" />
                  <p className="text-sm text-red-300 text-center font-medium leading-relaxed">{error}</p>
                </div>
              )}
            </div>

            {/* iOS file-capture fallback */}
            {!error && (
              <label
                className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold cursor-pointer active:opacity-70 transition-opacity"
                style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#4ade80' }}
              >
                <Camera className="w-4 h-4" />
                {hasBarcodeApi ? 'Capture Image to Scan' : 'Capture & Scan (iOS)'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={handleFileCapture}
                />
              </label>
            )}
          </div>
        )}

        {/* ── Manual entry ────────────────────────────────────────────────── */}
        {mode === 'manual' && !result && !loading && (
          <form onSubmit={handleManualSubmit} className="flex flex-col gap-3">
            <div
              className="rounded-2xl p-4 flex flex-col gap-2"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                Vehicle / Asset Number
              </label>
              <p className="text-[10px] text-gray-600">Enter asset no., registration no., or tyre serial</p>
              <input
                type="text"
                value={manualSerial}
                onChange={e => setManualSerial(e.target.value.toUpperCase())}
                placeholder="e.g. CM-0123 or REG-456"
                className="w-full bg-transparent text-white placeholder-gray-700 focus:outline-none text-base font-mono caret-green-400"
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
              />
            </div>
            <button
              type="submit"
              disabled={!manualSerial.trim() || loading}
              className="flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white transition-opacity disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', boxShadow: '0 0 20px rgba(22,163,74,0.3)' }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Look Up
            </button>
          </form>
        )}

        {/* ── Loading ─────────────────────────────────────────────────────── */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <Loader2 className="w-8 h-8 text-green-400" />
            </motion.div>
            <p className="text-sm text-gray-400 font-medium">Looking up…</p>
          </div>
        )}

        {/* ── Result ──────────────────────────────────────────────────────── */}
        {result && !loading && (
          <div className="flex flex-col gap-3">
            <motion.div
              className="rounded-2xl overflow-hidden"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              style={{
                border: `1px solid ${
                  result.tyre  ? 'rgba(22,163,74,0.35)' :
                  result.fleet ? 'rgba(59,130,246,0.35)' :
                                 'rgba(239,68,68,0.35)'
                }`,
              }}
            >
              {/* Result header */}
              <div
                className="flex items-center gap-3 px-4 py-3.5"
                style={{
                  background: result.tyre  ? 'rgba(22,163,74,0.08)' :
                              result.fleet ? 'rgba(59,130,246,0.08)' :
                                             'rgba(239,68,68,0.08)',
                }}
              >
                {result.tyre
                  ? <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                  : result.fleet
                    ? <ClipboardCheck className="w-5 h-5 text-blue-400 flex-shrink-0" />
                    : <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />}
                <div>
                  <p className="text-sm font-bold text-white font-mono leading-tight">{result.serial}</p>
                  <p className={`text-xs mt-0.5 ${
                    result.tyre  ? 'text-green-400' :
                    result.fleet ? 'text-blue-400'  :
                                   'text-red-400'
                  }`}>
                    {result.tyre  ? 'Tyre found in database' :
                     result.fleet ? 'Vehicle asset found' :
                                    'Not found in database'}
                  </p>
                </div>
                {result.tyre?.risk_level && riskStyle && (
                  <span
                    className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: riskStyle.bg, border: `1px solid ${riskStyle.border}`, color: riskStyle.text }}
                  >
                    {result.tyre.risk_level}
                  </span>
                )}
              </div>

              {/* Tyre details grid */}
              {result.tyre && (
                <div
                  className="px-4 py-3 grid grid-cols-2 gap-3"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                >
                  {[
                    ['Asset',    result.tyre.asset_no],
                    ['Brand',    result.tyre.brand],
                    ['Site',     result.tyre.site],
                    ['Status',   result.tyre.status],
                    ['Tread',    result.tyre.tread_depth  != null ? `${result.tyre.tread_depth} mm`  : null],
                    ['Pressure', result.tyre.pressure     != null ? `${result.tyre.pressure} PSI`    : null],
                    ['Cost',     result.tyre.cost         != null ? `$${Number(result.tyre.cost).toLocaleString()}` : null],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">{label}</p>
                      <p className="text-sm font-semibold text-white mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Fleet/asset details grid */}
              {result.fleet && (
                <div
                  className="px-4 py-3 grid grid-cols-2 gap-3"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                >
                  {[
                    ['Asset No',      result.fleet.asset_no],
                    ['Vehicle Type',  result.fleet.vehicle_type],
                    ['Site',          result.fleet.site],
                    ['Registration',  result.fleet.registration_no],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">{label}</p>
                      <p className="text-sm font-semibold text-white mt-0.5">{value}</p>
                    </div>
                  ))}
                  <div className="col-span-2 mt-1 pt-2" style={{ borderTop: '1px solid rgba(59,130,246,0.15)' }}>
                    <p className="text-[10px] text-blue-400 font-medium">Ready to start daily tyre inspection checklist</p>
                  </div>
                </div>
              )}
            </motion.div>

            {/* Actions */}
            <div className="flex gap-2">
              {result.fleet && (
                <button
                  onClick={handleStartChecklist}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white transition-opacity active:opacity-75"
                  style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', boxShadow: '0 0 20px rgba(59,130,246,0.3)' }}
                >
                  <ClipboardCheck className="w-4 h-4" />
                  Start Checklist
                </button>
              )}
              {result.tyre && onResult && (
                <button
                  onClick={handleUse}
                  className="flex-1 py-3.5 rounded-xl text-sm font-bold text-white transition-opacity active:opacity-75"
                  style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', boxShadow: '0 0 20px rgba(22,163,74,0.3)' }}
                >
                  Use This Tyre
                </button>
              )}
              <button
                onClick={resetScan}
                className="flex-1 flex items-center justify-center gap-1.5 py-3.5 rounded-xl text-sm font-bold text-gray-300 transition-opacity active:opacity-75"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Scan Again
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
