/**
 * Camera barcode / QR reader for the physical-inventory capture desk.
 *
 * Same BarcodeDetector approach already shipped in TyreScanCamera.jsx and
 * AssetIdentifyScanner.jsx (no new library). It only READS a code and hands
 * it back; the capture desk then runs its normal search. Browsers without
 * BarcodeDetector (Firefox, older Safari) never show the camera button
 * (`codeScanSupported()`), so typing / a USB scanner stays the path there.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../ui/Modal'

const FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'data_matrix']

export function codeScanSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
    && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export default function CodeScanCamera({ open, onClose, onCode, t }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const [error, setError] = useState('')
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    if (!open) return undefined
    let live = true
    setError('')
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!live) { stream.getTracks().forEach((tr) => tr.stop()); return }
        streamRef.current = stream
        const vid = videoRef.current
        if (vid) { vid.srcObject = stream; await vid.play().catch(() => {}) }
        const detector = new window.BarcodeDetector({ formats: FORMATS })
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        timerRef.current = setInterval(async () => {
          const v = videoRef.current
          if (!v || v.readyState < 2 || !streamRef.current) return
          canvas.width = v.videoWidth
          canvas.height = v.videoHeight
          ctx.drawImage(v, 0, 0)
          try {
            const codes = await detector.detect(canvas)
            const raw = codes?.[0]?.rawValue
            if (raw) { stop(); onCodeRef.current?.(String(raw).trim()) }
          } catch { /* one bad frame: keep reading */ }
        }, 200)
      } catch (err) {
        if (live) setError(err?.name === 'NotAllowedError' ? t('inventory.pi.capture.cameraDenied') : t('inventory.pi.capture.cameraFailed'))
      }
    })()
    return () => { live = false; stop() }
  }, [open, stop, t])

  return (
    <Modal open={open} onClose={() => { stop(); onClose() }} title={t('inventory.pi.capture.scanCamera')} size="md"
      footer={<button type="button" className="cc-btn-ghost inv-pi-big" onClick={() => { stop(); onClose() }}>{t('inventory.actions.cancel')}</button>}>
      {error
        ? <p role="alert" className="cc-na">{error}</p>
        : (
          <div className="inv-pi-camera">
            <video ref={videoRef} muted playsInline aria-label={t('inventory.pi.capture.scanCamera')} />
            <p className="cc-na">{t('inventory.pi.capture.scanHint')}</p>
          </div>
        )}
    </Modal>
  )
}
