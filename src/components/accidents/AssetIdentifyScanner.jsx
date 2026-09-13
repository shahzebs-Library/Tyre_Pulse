/**
 * AssetIdentifyScanner — the "Identify asset" step from the Report Accident
 * wizard mockup: scan a QR/barcode label (or type the code) and auto-fill the
 * incident form from the fleet master. Web port of the mobile scan-and-resolve
 * pattern (mobile/lib/assetLookup.ts's extractScanCode + lookupAssetByCode),
 * using this browser's own BarcodeDetector camera approach - the same one
 * already shipped in TyreScanCamera.jsx - rather than a second scanning
 * mechanism.
 *
 * Camera scanning degrades honestly: browsers without BarcodeDetector (Firefox,
 * older Safari) open straight to manual entry, which resolves through the exact
 * same lookupScannedAsset ladder, so the form never depends on camera support.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { ScanLine, Camera, Keyboard, Search, CheckCircle2, AlertTriangle, Loader2, X, RefreshCw } from 'lucide-react'
import { lookupScannedAsset } from '../../lib/api/assetScan'
import { toUserMessage } from '../../lib/safeError'

function barcodeDetectorSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

export default function AssetIdentifyScanner({ country, onResult, onClose }) {
  const hasBarcodeApi = barcodeDetectorSupported()
  const [mode, setMode] = useState(hasBarcodeApi ? 'camera' : 'manual')
  const [scanning, setScanning] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null) // {code, asset|null}
  const [lookupErr, setLookupErr] = useState('')

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const intervalRef = useRef(null)
  const canvasRef = useRef(null)
  const detectorRef = useRef(null)

  const stopCamera = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const runLookup = useCallback(async (raw) => {
    const code = String(raw || '').trim()
    if (!code) return
    stopCamera()
    setScanning(false)
    setLoading(true)
    setLookupErr('')
    try {
      const asset = await lookupScannedAsset(code, country)
      setResult({ code, asset })
    } catch (e) {
      setLookupErr(toUserMessage(e, 'Could not look up that code.'))
      setResult({ code, asset: null })
    } finally {
      setLoading(false)
    }
  }, [country, stopCamera])

  const startCamera = useCallback(async () => {
    setCameraError(''); setResult(null); setScanning(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      detectorRef.current = new window.BarcodeDetector({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'data_matrix'],
      })
      if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
      const ctx = canvasRef.current.getContext('2d')
      intervalRef.current = setInterval(async () => {
        const vid = videoRef.current
        if (!vid || vid.readyState < 2 || !streamRef.current) return
        canvasRef.current.width = vid.videoWidth
        canvasRef.current.height = vid.videoHeight
        ctx.drawImage(vid, 0, 0)
        try {
          const codes = await detectorRef.current.detect(canvasRef.current)
          if (codes.length > 0) {
            clearInterval(intervalRef.current)
            runLookup(codes[0].rawValue)
          }
        } catch { /* ignore individual frame errors */ }
      }, 200)
    } catch (e) {
      setScanning(false)
      setCameraError(
        e?.name === 'NotAllowedError'
          ? 'Camera permission denied - allow camera access or use manual entry.'
          : 'Could not access the camera - use manual entry below.',
      )
    }
  }, [runLookup])

  useEffect(() => {
    if (mode === 'camera') startCamera()
    return stopCamera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => () => stopCamera(), [stopCamera])

  function switchMode(m) {
    stopCamera(); setScanning(false); setResult(null); setCameraError(''); setLookupErr(''); setManualCode('')
    setMode(m)
  }

  function resetScan() {
    setResult(null); setCameraError(''); setLookupErr(''); setManualCode('')
    if (mode === 'camera') startCamera()
  }

  function handleManualSubmit(e) {
    e.preventDefault()
    runLookup(manualCode)
  }

  function useResult() {
    if (result?.asset) { onResult?.(result.asset); onClose?.() }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--input-border)] bg-[var(--surface-1,var(--input-bg))] p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <ScanLine size={16} /> Identify asset
          </p>
          <button onClick={() => { stopCamera(); onClose?.() }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          {[
            { id: 'camera', label: 'Scan', icon: Camera, disabled: !hasBarcodeApi },
            { id: 'manual', label: 'Type code', icon: Keyboard },
          ].map(({ id, label, icon: Icon, disabled }) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => switchMode(id)}
              className={`flex-1 text-xs font-semibold py-2 rounded-lg border inline-flex items-center justify-center gap-1.5 disabled:opacity-40 ${
                mode === id ? 'border-green-500 text-green-400 bg-green-900/10' : 'border-[var(--input-border)] text-[var(--text-secondary)]'
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {!hasBarcodeApi && mode === 'camera' && (
          <p className="text-[11px] text-[var(--text-muted)] mb-2">Camera scanning is not supported on this browser - use "Type code".</p>
        )}

        {mode === 'camera' && !result && !loading && (
          <div className="relative rounded-lg overflow-hidden bg-black" style={{ aspectRatio: '4/3' }}>
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
            {scanning && !cameraError && (
              <p className="absolute bottom-2 inset-x-0 text-center text-[11px] text-green-400 font-semibold">Point at the asset's QR or barcode label</p>
            )}
            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
                <AlertTriangle size={24} className="text-red-400" />
                <p className="text-xs text-red-300 text-center">{cameraError}</p>
              </div>
            )}
          </div>
        )}

        {mode === 'manual' && !result && !loading && (
          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label className="label">Asset no. / fleet no. / QR payload</label>
            <input
              className="input w-full font-mono"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="e.g. TRK-001"
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="submit" className="btn-primary text-xs w-full inline-flex items-center justify-center gap-1.5" disabled={!manualCode.trim()}>
              <Search size={13} /> Look up
            </button>
          </form>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Loader2 size={20} className="animate-spin text-green-400" />
            <p className="text-xs text-[var(--text-muted)]">Looking up…</p>
          </div>
        )}

        {result && !loading && (
          <div className="space-y-3">
            <div className={`rounded-lg border px-3 py-2.5 ${result.asset ? 'border-green-700/50 bg-green-900/10' : 'border-red-700/50 bg-red-900/10'}`}>
              <p className="text-xs font-mono text-[var(--text-primary)]">{result.code}</p>
              <p className={`text-xs mt-0.5 flex items-center gap-1.5 ${result.asset ? 'text-green-400' : 'text-red-400'}`}>
                {result.asset ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                {result.asset ? 'Vehicle found' : lookupErr || 'No asset matches that code in the fleet register'}
              </p>
              {result.asset && (
                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                  <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Asset no.</p><p className="text-[var(--text-primary)]">{result.asset.asset_no}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Type</p><p className="text-[var(--text-primary)]">{result.asset.vehicle_type || 'N/A'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Site</p><p className="text-[var(--text-primary)]">{result.asset.site || 'N/A'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Fleet no.</p><p className="text-[var(--text-primary)]">{result.asset.fleet_number || result.asset.registration_no || 'N/A'}</p></div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {result.asset && (
                <button type="button" className="btn-primary text-xs flex-1" onClick={useResult}>Use this asset</button>
              )}
              <button type="button" className="btn-secondary text-xs flex-1 inline-flex items-center justify-center gap-1.5" onClick={resetScan}>
                <RefreshCw size={12} /> {result.asset ? 'Scan again' : 'Try again'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
