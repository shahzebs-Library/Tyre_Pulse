import React, { useState, useCallback, useEffect } from 'react'
import {
  CheckCircle2, Undo2, XCircle, PenLine, Camera, MapPin, Trash2,
  AlertTriangle, RefreshCw, Loader2,
} from 'lucide-react'
import SignaturePad from '../SignaturePad'

/**
 * ApprovalAction — shared capture + submit control for a single workflow step.
 *
 * Enforces (client-side, convenience only — server is authoritative) the step's
 * requirements before enabling Approve / Return / Reject:
 *   - signature (reuses SignaturePad, stores data URL + printed name) when requireSignature
 *   - one or more photos (file input → data URL, thumbnails) when requirePhoto
 *   - GPS auto-captured via navigator.geolocation when requireGps (retry + graceful denial)
 *   - a comment textarea (mandatory when Returning for correction)
 *
 * Props:
 *   requirements = { requireSignature, requirePhoto, requireGps, allowReturn }
 *   onAct(action, { comment, signature, printedName, photos, gps, deviceInfo })
 *          action ∈ 'approve' | 'return' | 'reject'
 *   busy   - disables everything (submit in flight)
 */

const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB per file

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function deviceInfo() {
  const nav = typeof navigator !== 'undefined' ? navigator : {}
  return {
    userAgent: nav.userAgent || '',
    platform: nav.platform || '',
  }
}

export default function ApprovalAction({ requirements = {}, onAct, busy = false }) {
  const {
    requireSignature = false,
    requirePhoto = false,
    requireGps = false,
    allowReturn = false,
  } = requirements

  const [comment, setComment] = useState('')
  const [signature, setSignature] = useState(null)
  const [printedName, setPrintedName] = useState('')
  const [photos, setPhotos] = useState([]) // [{ id, dataUrl, name }]
  const [gps, setGps] = useState(null)
  const [gpsState, setGpsState] = useState('idle') // idle | locating | ready | denied | unsupported
  const [gpsError, setGpsError] = useState('')
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  const [photoError, setPhotoError] = useState('')

  const geoAvailable = typeof navigator !== 'undefined'
    && navigator.geolocation
    && typeof navigator.geolocation.getCurrentPosition === 'function'

  const captureGps = useCallback(() => {
    if (!geoAvailable) {
      setGpsState('unsupported')
      setGpsError('Geolocation is not available on this device.')
      return
    }
    setGpsState('locating')
    setGpsError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords || {}
        setGps({ lat: latitude, lng: longitude, accuracy })
        setGpsState('ready')
      },
      (err) => {
        setGps(null)
        setGpsState(err && err.code === 1 ? 'denied' : 'unsupported')
        setGpsError(
          err && err.code === 1
            ? 'Location permission denied. Enable it and retry.'
            : 'Could not determine location. Retry.',
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    )
  }, [geoAvailable])

  // Auto-capture GPS once when required.
  useEffect(() => {
    if (requireGps) captureGps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requireGps])

  const handleFiles = useCallback(async (fileList) => {
    setPhotoError('')
    const files = Array.from(fileList || [])
    if (!files.length) return
    const next = []
    for (const file of files) {
      if (file.size > MAX_PHOTO_BYTES) {
        setPhotoError(`"${file.name}" exceeds 8 MB and was skipped.`)
        continue
      }
      try {
        const dataUrl = await readFileAsDataUrl(file)
        next.push({ id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`, dataUrl, name: file.name })
      } catch {
        setPhotoError(`Could not read "${file.name}".`)
      }
    }
    if (next.length) setPhotos((prev) => [...prev, ...next])
  }, [])

  function removePhoto(id) {
    setPhotos((prev) => prev.filter((p) => p.id !== id))
  }

  function handleSignatureSave(dataUrl) {
    setSignature(dataUrl)
    setShowSignaturePad(false)
  }

  // ── Requirement resolution ────────────────────────────────────────────────
  const missing = []
  if (requireSignature && !signature) missing.push('signature')
  if (requirePhoto && photos.length === 0) missing.push('at least one photo')
  if (requireGps && !gps) missing.push('GPS location')

  const commonReady = missing.length === 0 && !busy

  // Approve / Reject need the common requirements; Return additionally needs a comment.
  const approveReady = commonReady
  const rejectReady = commonReady
  const returnReady = commonReady && comment.trim().length > 0

  function submit(action) {
    if (busy) return
    if (action === 'return' && !returnReady) return
    if (action !== 'return' && !commonReady) return
    onAct(action, {
      comment: comment.trim(),
      signature: signature || null,
      printedName: printedName.trim() || null,
      photos: photos.map((p) => p.dataUrl),
      gps: gps || null,
      deviceInfo: deviceInfo(),
    })
  }

  return (
    <div
      className="card space-y-4"
      style={{ color: 'var(--text-primary)' }}
    >
      {/* Signature */}
      {requireSignature && (
        <section className="space-y-2">
          <label className="label flex items-center gap-1.5">
            <PenLine size={13} /> Signature <span className="text-red-400">*</span>
          </label>
          {signature ? (
            <div className="flex items-center gap-3">
              <img
                src={signature}
                alt="Captured signature"
                className="h-16 w-auto rounded-lg border"
                style={{ borderColor: 'var(--border-dim)', background: '#fff' }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowSignaturePad(true)}
                className="btn-secondary text-sm disabled:opacity-40"
              >
                Re-sign
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowSignaturePad(true)}
              className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-40"
            >
              <PenLine size={14} /> Add Signature
            </button>
          )}
          <input
            type="text"
            className="input"
            placeholder="Printed name"
            value={printedName}
            disabled={busy}
            onChange={(e) => setPrintedName(e.target.value)}
          />
        </section>
      )}

      {/* Photos */}
      {requirePhoto && (
        <section className="space-y-2">
          <label className="label flex items-center gap-1.5">
            <Camera size={13} /> Photos <span className="text-red-400">*</span>
          </label>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            aria-label="Upload photos"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
            className="input text-sm file:mr-3 file:rounded file:border-0 file:bg-blue-900/40 file:px-3 file:py-1 file:text-blue-200"
          />
          {photoError && (
            <p className="text-xs text-amber-400">{photoError}</p>
          )}
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photos.map((p) => (
                <div key={p.id} className="relative group">
                  <img
                    src={p.dataUrl}
                    alt={p.name}
                    className="h-16 w-16 rounded-lg border object-cover"
                    style={{ borderColor: 'var(--border-dim)' }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removePhoto(p.id)}
                    aria-label={`Remove ${p.name}`}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-red-700 p-0.5 text-white shadow disabled:opacity-40"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* GPS */}
      {requireGps && (
        <section className="space-y-2">
          <label className="label flex items-center gap-1.5">
            <MapPin size={13} /> GPS Location <span className="text-red-400">*</span>
          </label>
          <div className="flex items-center gap-3 text-sm">
            {gpsState === 'ready' && gps ? (
              <span className="text-green-300">
                {Number(gps.lat).toFixed(5)}, {Number(gps.lng).toFixed(5)}
                {gps.accuracy != null && (
                  <span className="text-gray-500"> · ±{Math.round(gps.accuracy)}m</span>
                )}
              </span>
            ) : gpsState === 'locating' ? (
              <span className="flex items-center gap-1.5 text-gray-400">
                <Loader2 size={13} className="animate-spin" /> Locating…
              </span>
            ) : (
              <span className="text-amber-400">{gpsError || 'Location not captured.'}</span>
            )}
            <button
              type="button"
              disabled={busy || gpsState === 'locating'}
              onClick={captureGps}
              className="btn-secondary flex items-center gap-1.5 text-xs disabled:opacity-40"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        </section>
      )}

      {/* Comment */}
      <section className="space-y-2">
        <label className="label">
          Comment
          {allowReturn && (
            <span className="text-gray-500"> (required to return for correction)</span>
          )}
        </label>
        <textarea
          className="input min-h-[72px] resize-y"
          placeholder="Add a comment…"
          value={comment}
          disabled={busy}
          aria-label="Comment"
          onChange={(e) => setComment(e.target.value)}
        />
      </section>

      {/* Missing-requirement hints */}
      {missing.length > 0 && (
        <div
          className="flex items-start gap-2 rounded-lg border p-2.5 text-xs"
          style={{ borderColor: 'var(--border-dim)', background: 'var(--surface-1)' }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          <span className="text-amber-300">Required before submitting: {missing.join(', ')}.</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!approveReady}
          onClick={() => submit('approve')}
          className="btn-primary flex items-center gap-2 bg-green-700 hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          Approve
        </button>

        {allowReturn && (
          <button
            type="button"
            disabled={!returnReady}
            onClick={() => submit('return')}
            title={!comment.trim() ? 'A comment is required to return for correction' : undefined}
            className="btn-secondary flex items-center gap-2 border-orange-700/50 text-orange-300 hover:bg-orange-900/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Undo2 size={15} /> Return for Correction
          </button>
        )}

        <button
          type="button"
          disabled={!rejectReady}
          onClick={() => submit('reject')}
          className="btn-secondary flex items-center gap-2 border-red-800/50 text-red-300 hover:bg-red-900/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <XCircle size={15} /> Reject
        </button>
      </div>

      {showSignaturePad && (
        <SignaturePad
          label="Approval Signature"
          inspectorName={printedName}
          onSave={handleSignatureSave}
          onClose={() => setShowSignaturePad(false)}
        />
      )}
    </div>
  )
}
