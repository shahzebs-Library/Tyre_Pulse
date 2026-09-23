/**
 * EvidenceTable — the reusable documents/photos table shared by the
 * Responsibility & Payment tab ("Responsibility documents") and the Workshop
 * Assessment tab ("Attachments"). Backed by accidentEvidence.js
 * (accident_evidence, scoped to one workstream_key so the two mounts never
 * see each other's files).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, Upload, Loader2, Check, X, FileText, Image as ImageIcon, AlertCircle } from 'lucide-react'
import { listEvidence, addEvidence, verifyEvidence } from '../../lib/api/accidentEvidence'
import { safeHref } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'

const KIND_ICON = { photo: ImageIcon, video: ImageIcon, document: FileText }
const STATUS_TONE = {
  verified: 'text-green-400', rejected: 'text-red-400', unverified: 'text-[var(--text-muted)]',
}

/**
 * @param {{accidentId:string, workstreamKey:string, elevated:boolean, title?:string,
 *   defaultKind?:'photo'|'video'|'document'}} props
 */
export default function EvidenceTable({ accidentId, workstreamKey, elevated, title = 'Documents', defaultKind = 'document' }) {
  const [rows, setRows] = useState(null) // null = loading
  const [err, setErr] = useState('')
  const [uploading, setUploading] = useState(false)
  const [caption, setCaption] = useState('')
  const inputRef = useRef(null)

  const load = useCallback(async () => {
    setErr('')
    try {
      setRows(await listEvidence(accidentId, { workstreamKey }))
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the attached documents.'))
      setRows([])
    }
  }, [accidentId, workstreamKey])

  useEffect(() => { load() }, [load])

  async function onPick(e) {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setUploading(true); setErr('')
    try {
      const kind = file.type?.startsWith('image/') ? 'photo' : (file.type?.startsWith('video/') ? 'video' : defaultKind)
      const saved = await addEvidence(accidentId, file, { kind, caption: caption || undefined, workstreamKey })
      setRows((prev) => [saved, ...(prev || [])])
      setCaption('')
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not attach that file.'))
    } finally {
      setUploading(false)
    }
  }

  async function verify(row, decision) {
    setErr('')
    try {
      const saved = await verifyEvidence(accidentId, row.id, decision)
      setRows((prev) => (prev || []).map((r) => (r.id === row.id ? saved : r)))
    } catch (e) {
      setErr(toUserMessage(e, 'Could not update that item.'))
    }
  }

  if (rows === null) {
    return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 size={13} className="animate-spin" /> Loading documents…</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5"><Paperclip size={14} /> {title}</h4>
        <span className="text-[11px] text-[var(--text-muted)]">{rows.length} attached</span>
      </div>

      {rows.length === 0 && <p className="text-xs text-[var(--text-muted)]">Nothing attached yet.</p>}

      <div className="space-y-1.5">
        {rows.map((r) => {
          const Icon = KIND_ICON[r.kind] || FileText
          const href = safeHref(r.storage_ref)
          return (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--input-border)] px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon size={14} className="text-[var(--text-muted)] shrink-0" />
                <div className="min-w-0">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline truncate block">
                      {r.file_name || r.caption || r.document_type || 'File'}
                    </a>
                  ) : (
                    <span className="text-xs text-[var(--text-primary)] truncate block">{r.file_name || r.caption || 'File'}</span>
                  )}
                  <p className="text-[10px] text-[var(--text-muted)]">{new Date(r.created_at).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[11px] ${STATUS_TONE[r.verification_status] || 'text-[var(--text-muted)]'}`}>
                  {r.verification_status === 'verified' ? 'Verified' : r.verification_status === 'rejected' ? 'Rejected' : 'Unverified'}
                </span>
                {elevated && r.verification_status !== 'verified' && (
                  <button type="button" title="Verify" className="text-green-400 hover:text-green-300" onClick={() => verify(r, 'verified')}><Check size={14} /></button>
                )}
                {elevated && r.verification_status !== 'rejected' && (
                  <button type="button" title="Reject" className="text-red-400 hover:text-red-300" onClick={() => verify(r, 'rejected')}><X size={14} /></button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {elevated && (
        <div className="flex items-center gap-2 pt-2 border-t border-[var(--input-border)]">
          <input className="input text-xs flex-1" placeholder="Optional caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
          <input ref={inputRef} type="file" className="hidden" onChange={onPick} />
          <button
            type="button"
            className="btn-secondary text-xs inline-flex items-center gap-1.5 shrink-0"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Attach file
          </button>
        </div>
      )}
      {err && <p className="text-[11px] text-red-400 flex items-center gap-1"><AlertCircle size={11} /> {err}</p>}
    </div>
  )
}
