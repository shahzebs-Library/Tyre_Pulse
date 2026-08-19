import { useCallback, useEffect, useRef, useState } from 'react'
import { PenLine, Check, AlertTriangle, Loader2 } from 'lucide-react'
import SignatureCapture from './SignatureCapture'
import SignatureView from './SignatureView'
import { normaliseSignature } from '../../lib/savedSignature'
import * as sigApi from '../../lib/api/userSignature'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'

/**
 * A signature on an approval screen, with the person's own saved mark already in it.
 *
 * WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT. Before V601 every
 * approval asked the approver to redraw their signature from nothing - 379
 * inspections have been signed off on this system and every one of those marks
 * was drawn on the spot. This loads the mark they saved earlier so they do not
 * have to.
 *
 * PRE-FILLING IS NOT SIGNING. The saved mark is loaded into the field and it is
 * SHOWN - as the actual image, under a heading that says it is the saved one -
 * and nothing at all is recorded until the person presses the approve button
 * their parent screen owns. A signature that appeared without being visible
 * would be indistinguishable from the app signing on someone's behalf, so it is
 * never attached silently.
 *
 * CHANGING IT IS ALWAYS ONE CLICK AWAY. "Draw a new signature" replaces the pad,
 * and a tick box decides whether that new mark also becomes the remembered one.
 * The box starts ticked for a person who has never saved one (that is the whole
 * point of drawing it) and UNTICKED for someone who already has one, because a
 * one-off signature for one sheet must not silently overwrite the mark they
 * chose.
 *
 * There is no second pad here: the drawing itself is SignatureCapture, the same
 * component the checklist path already used, so the stored format does not
 * change.
 *
 * @param {object} props
 * @param {(sig:string|null)=>void} props.onChange  the mark to attach, or null
 * @param {string} [props.label]
 * @param {number} [props.height]
 */
export default function SignatureField({ onChange, label = 'Sign here', height = 130 }) {
  const { t } = useLanguage()
  const [saved, setSaved] = useState(null)
  const [loading, setLoading] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [remember, setRemember] = useState(true)
  const [note, setNote] = useState(null)

  // What we last wrote, so finishing a stroke on an unchanged drawing does not
  // send the same value to the server again.
  const persistedRef = useRef(null)
  // onChange is called from effects and handlers; holding it in a ref keeps a
  // caller's inline arrow from re-running the load effect on every render.
  const emitRef = useRef(onChange)
  emitRef.current = onChange

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    sigApi.getMySignature()
      .then((value) => {
        if (cancelled) return
        const v = normaliseSignature(value)
        setSaved(v)
        persistedRef.current = v
        // Nobody has a saved mark to protect, so remembering the first one is
        // the behaviour that was asked for.
        setRemember(!v)
        if (v) emitRef.current?.(v)
        else setDrawing(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  /** A stroke finished (or the pad was cleared). */
  const handleDrawn = useCallback(async (value) => {
    const v = normaliseSignature(value)
    emitRef.current?.(v)
    setNote(null)
    if (!v || !remember) return
    if (persistedRef.current === v) return
    try {
      await sigApi.saveMySignature(v)
      persistedRef.current = v
      setSaved(v)
      setNote({ kind: 'ok', text: t('signature.field.saved') })
    } catch (err) {
      // The drawn mark is still attached; only remembering it failed.
      setNote({ kind: 'err', text: toUserMessage(err, t('signature.field.saveFailed')) })
    }
  }, [remember, t])

  function useSavedAgain() {
    setDrawing(false)
    setNote(null)
    emitRef.current?.(saved)
  }

  function startDrawing() {
    setDrawing(true)
    setNote(null)
    // Nothing is attached until they actually draw, so the parent must not keep
    // thinking the saved mark is in play.
    emitRef.current?.(null)
  }

  if (loading) {
    return (
      <p className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" /> {t('signature.field.loading')}
      </p>
    )
  }

  return (
    <div data-testid="signature-field">
      {!drawing && saved ? (
        <div className="rounded-xl border border-[var(--input-border)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] inline-flex items-center gap-1.5 mb-2">
            <PenLine className="w-3 h-3" /> {label}
          </p>
          <SignatureView value={saved} label={t('signature.field.savedHeading')} height={72} />
          <p className="text-xs text-[var(--text-muted)] mt-2">{t('signature.field.savedInUse')}</p>
          <button
            type="button"
            onClick={startDrawing}
            className="mt-2 text-xs underline text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t('signature.field.drawNew')}
          </button>
        </div>
      ) : (
        <div>
          <SignatureCapture label={label} height={height} onChange={handleDrawn} />
          <label className="flex items-start gap-2 mt-2 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t('signature.field.remember')}
              <span className="block text-[var(--text-muted)]">{t('signature.field.rememberHint')}</span>
            </span>
          </label>
          {saved && (
            <button
              type="button"
              onClick={useSavedAgain}
              className="mt-2 text-xs underline text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {t('signature.field.useSaved')}
            </button>
          )}
        </div>
      )}

      {note && (
        <p className={`text-xs mt-2 inline-flex items-start gap-1.5 ${note.kind === 'ok' ? 'text-green-400' : 'text-amber-400'}`}>
          {note.kind === 'ok' ? <Check className="w-3.5 h-3.5 shrink-0 mt-px" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />}
          {note.text}
        </p>
      )}
    </div>
  )
}
