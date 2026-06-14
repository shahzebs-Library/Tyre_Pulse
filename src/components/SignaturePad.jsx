import { useRef, useEffect, useState, useCallback } from 'react'
import { X, RotateCcw, Check, PenLine } from 'lucide-react'

/**
 * Canvas-based signature capture pad.
 * Supports mouse and touch. Auto-sizes to container width.
 * Props:
 *   label          – header label text (optional)
 *   inspectorName  – pre-fills name display below pad
 *   employeeId     – pre-fills ID display below pad
 *   onSave(dataUrl) – called with PNG data-URL when user confirms
 *   onClose()      – called when user cancels
 */
export default function SignaturePad({ label = 'Inspector Signature', inspectorName = '', employeeId = '', onSave, onClose }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const drawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const [isEmpty, setIsEmpty] = useState(true)

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const w = container.clientWidth
    const h = Math.round(w * 0.38)
    // Save existing drawing
    const prev = canvas.toDataURL()
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#f9fafb'
    ctx.fillRect(0, 0, w, h)
    // Restore (best-effort on resize)
    if (!isEmpty) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = prev
    }
    setupCtx(ctx)
  }, [isEmpty])

  function setupCtx(ctx) {
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [resize])

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if (e.touches) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY }
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function startDraw(e) {
    e.preventDefault()
    const canvas = canvasRef.current
    const pos = getPos(e, canvas)
    drawing.current = true
    lastPos.current = pos
    const ctx = canvas.getContext('2d')
    setupCtx(ctx)
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, 1, 0, Math.PI * 2)
    ctx.fill()
    setIsEmpty(false)
  }

  function draw(e) {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    setupCtx(ctx)
    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPos.current = pos
  }

  function endDraw(e) {
    e.preventDefault()
    drawing.current = false
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#f9fafb'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
  }

  function confirm() {
    if (isEmpty) return
    const canvas = canvasRef.current
    // Trim to content — export with white background for PDF embedding
    const trimmed = document.createElement('canvas')
    trimmed.width = canvas.width
    trimmed.height = canvas.height
    const tCtx = trimmed.getContext('2d')
    tCtx.fillStyle = '#ffffff'
    tCtx.fillRect(0, 0, trimmed.width, trimmed.height)
    tCtx.drawImage(canvas, 0, 0)
    onSave(trimmed.toDataURL('image/png'))
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: '20px',
        width: '100%', maxWidth: 480, boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10, background: '#f0fdf4',
              border: '1.5px solid #86efac', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PenLine size={16} color="#16a34a" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{label}</div>
              {(inspectorName || employeeId) && (
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  {inspectorName}{employeeId ? ` · ${employeeId}` : ''}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Canvas */}
        <div ref={containerRef} style={{
          border: '2px dashed #d1d5db', borderRadius: 12,
          overflow: 'hidden', cursor: 'crosshair', touchAction: 'none',
          background: '#f9fafb',
        }}>
          <canvas
            ref={canvasRef}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
            style={{ display: 'block', width: '100%' }}
          />
        </div>

        {isEmpty && (
          <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
            Draw your signature above using finger or mouse
          </p>
        )}

        {/* Signature identity stamp */}
        {!isEmpty && (inspectorName || employeeId) && (
          <div style={{
            marginTop: 8, padding: '6px 10px', borderRadius: 8,
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            fontSize: 11, color: '#166534',
          }}>
            Signed by: <strong>{inspectorName || 'Unknown'}</strong>
            {employeeId ? ` (${employeeId})` : ''} · {new Date().toLocaleString()}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            onClick={clear}
            style={{
              flex: 1, padding: '10px', borderRadius: 10, border: '1.5px solid #e5e7eb',
              background: '#f9fafb', color: '#374151', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <RotateCcw size={14} /> Clear
          </button>
          <button
            onClick={confirm}
            disabled={isEmpty}
            style={{
              flex: 2, padding: '10px', borderRadius: 10, border: 'none',
              background: isEmpty ? '#d1d5db' : '#16a34a',
              color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: isEmpty ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Check size={14} /> Confirm Signature
          </button>
        </div>
      </div>
    </div>
  )
}
