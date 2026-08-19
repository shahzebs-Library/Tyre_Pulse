import { useEffect, useState } from 'react'
import { PenLine, Trash2, Save, Loader2, Check, AlertTriangle } from 'lucide-react'
import SignatureCapture from '../checklist/SignatureCapture'
import SignatureView from '../checklist/SignatureView'
import * as sigApi from '../../lib/api/userSignature'
import { normaliseSignature } from '../../lib/savedSignature'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'

/**
 * The one place a person can look at, replace or delete their saved signature.
 *
 * A mark that is filled in automatically has to be inspectable somewhere that is
 * not an approval screen, otherwise the only way to check what is about to be
 * attached to a decision is to start making one. This is that place.
 *
 * Only the owner ever sees it. The row lives in V601 `user_signatures`, whose
 * only policies are "this row is mine" - which is why it is not a column on
 * `profiles`, where every colleague in the organisation can read every row.
 */
export default function MySignaturePanel() {
  const { t } = useLanguage()
  const [saved, setSaved] = useState(null)
  const [loading, setLoading] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  useEffect(() => {
    let cancelled = false
    sigApi.getMySignature()
      .then((v) => { if (!cancelled) setSaved(normaliseSignature(v)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function save() {
    if (!draft) return
    setBusy(true); setNote(null)
    try {
      const stored = await sigApi.saveMySignature(draft)
      setSaved(stored)
      setDrawing(false)
      setDraft(null)
      setNote({ kind: 'ok', text: t('signature.settings.savedOk') })
    } catch (err) {
      setNote({ kind: 'err', text: toUserMessage(err, t('signature.settings.failed')) })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true); setNote(null)
    try {
      await sigApi.clearMySignature()
      setSaved(null)
      setNote({ kind: 'ok', text: t('signature.settings.removed') })
    } catch (err) {
      setNote({ kind: 'err', text: toUserMessage(err, t('signature.settings.removeFailed')) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card space-y-4" data-testid="my-signature-panel">
      <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
        <PenLine size={16} /> {t('signature.settings.title')}
      </h2>
      <p className="text-xs text-[var(--text-secondary)]">{t('signature.settings.intro')}</p>

      {loading ? (
        <p className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> {t('signature.settings.loading')}
        </p>
      ) : drawing ? (
        <div className="space-y-3">
          <SignatureCapture label={t('signature.settings.title')} onChange={setDraft} />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={save}
              disabled={busy || !draft}
              className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Save size={14} /> {t('signature.settings.save')}
            </button>
            <button
              type="button"
              onClick={() => { setDrawing(false); setDraft(null) }}
              disabled={busy}
              className="btn-secondary text-sm"
            >
              {t('signature.settings.cancel')}
            </button>
          </div>
        </div>
      ) : saved ? (
        <div className="space-y-3">
          <SignatureView value={saved} label={t('signature.settings.title')} height={90} />
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setDrawing(true)} className="btn-secondary text-sm inline-flex items-center gap-2">
              <PenLine size={14} /> {t('signature.settings.replace')}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="text-sm inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-700/50 text-red-300 hover:bg-red-900/20 disabled:opacity-50"
            >
              <Trash2 size={14} /> {t('signature.settings.remove')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">{t('signature.settings.none')}</p>
          <button type="button" onClick={() => setDrawing(true)} className="btn-secondary text-sm inline-flex items-center gap-2">
            <PenLine size={14} /> {t('signature.settings.replace')}
          </button>
        </div>
      )}

      {note && (
        <p className={`text-sm inline-flex items-start gap-1.5 ${note.kind === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
          {note.kind === 'ok' ? <Check className="w-4 h-4 shrink-0 mt-px" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />}
          {note.text}
        </p>
      )}
    </div>
  )
}
