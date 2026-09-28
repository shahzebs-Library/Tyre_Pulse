/**
 * Login pictures - the administrator chooses which artwork each login country
 * shows on the phone before sign-in.
 *
 * Only pictures already inside the app can be offered (the phone draws this
 * screen with no network guaranteed), so the choice list is the bundled
 * catalog in lib/mobileLoginArt.js. Phones read the choice on their next
 * launch with a connection and keep the last one for offline starts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon, RotateCcw, Save } from 'lucide-react'
import { Panel, PanelHeader, Note, Btn, Badge, LoadingState, ErrorState } from '../../components/ui'
import { getMobileLoginArt, setMobileLoginArt } from '../../../lib/api/mobileOps'
import {
  LOGIN_ARTWORK, LOGIN_COUNTRIES, parseLoginArt, serializeLoginArt, defaultLoginArt, artworkByKey,
} from '../../../lib/mobileLoginArt'
import { toUserMessage } from '../../../lib/safeError'
import { whenText } from '../shared/pageKit'

export default function LoginArtworkPanel({ onSaved }) {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(defaultLoginArt())
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgIsError, setMsgIsError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await getMobileLoginArt()
      const m = parseLoginArt(r.value)
      setSaved(m); setDraft(m); setUpdatedAt(r.updatedAt)
    } catch (e) {
      setSaved(null)
      setError(toUserMessage(e, 'Could not read the login pictures. Saving is switched off until they can be read.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const dirty = useMemo(
    () => saved != null && serializeLoginArt(draft) !== serializeLoginArt(saved),
    [draft, saved],
  )

  async function save() {
    if (saved == null) return
    setSaving(true); setMsg('')
    try {
      const json = serializeLoginArt(draft)
      await setMobileLoginArt(json)
      setSaved(parseLoginArt(json)); setUpdatedAt(new Date().toISOString())
      // The change is saved; the audit entry is awaited so a failed audit is
      // reported instead of hidden behind the success message.
      try {
        await onSaved?.(json)
      } catch (e) {
        setMsgIsError(true)
        setMsg(toUserMessage(e, 'Saved, but the change could not be recorded in the audit log.'))
        return
      }
      setMsgIsError(false)
      setMsg('Saved. Phones show the new pictures the next time they open the app with a connection.')
    } catch (e) {
      setMsgIsError(true); setMsg(toUserMessage(e, 'Could not save the login pictures.'))
    } finally { setSaving(false) }
  }

  if (loading) return <LoadingState label="Reading login pictures" />

  return (
    <Panel>
      <PanelHeader
        icon={ImageIcon}
        title="Login pictures"
        subtitle={updatedAt ? `Last changed ${whenText(updatedAt)}` : 'Using each country’s own landmark'}
      />
      <div className="space-y-4">
        {error && <ErrorState message={error} onRetry={load} />}
        <Note>
          Choose the picture people see on the phone&apos;s sign-in screen for each country. Only pictures built into
          the app can be picked. A phone that has never been online shows the country&apos;s own landmark.
        </Note>

        {LOGIN_COUNTRIES.map((c) => {
          const current = draft[c.key]
          return (
            <fieldset key={c.key} className="space-y-2" disabled={saved == null || saving}>
              <legend className="text-sm font-semibold text-gray-100 flex items-center gap-2">
                {c.label}
                {current !== c.defaultArt && <Badge tone="info">Changed</Badge>}
              </legend>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {LOGIN_ARTWORK.map((a) => {
                  const on = current === a.key
                  return (
                    <label
                      key={a.key}
                      className={`cursor-pointer rounded-lg border overflow-hidden transition focus-within:ring-2 focus-within:ring-orange-500 ${on ? 'border-orange-500 ring-1 ring-orange-500' : 'border-gray-700 hover:border-gray-500'}`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`login-art-${c.key}`}
                        value={a.key}
                        checked={on}
                        onChange={() => setDraft((d) => ({ ...d, [c.key]: a.key }))}
                      />
                      <img src={a.preview} alt="" loading="lazy" className="w-full h-28 object-cover bg-gray-900" />
                      <div className="px-2 py-1.5 text-xs text-gray-300 flex items-center justify-between gap-1">
                        <span>{a.label}</span>
                        {a.key === c.defaultArt && <span className="text-gray-500">Default</span>}
                      </div>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )
        })}

        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="primary" icon={Save} busy={saving} onClick={save} disabled={!dirty || saving || saved == null}>
            Save pictures
          </Btn>
          <Btn icon={RotateCcw} onClick={() => setDraft(defaultLoginArt())} disabled={saving || saved == null}>
            Reset to country landmarks
          </Btn>
          {dirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
        </div>
        {msg && (
          <p role={msgIsError ? 'alert' : 'status'} className={`text-sm ${msgIsError ? 'text-red-400' : 'text-green-400'}`}>{msg}</p>
        )}
        <p className="text-xs text-gray-500">
          Currently saved: {LOGIN_COUNTRIES.map((c) => `${c.label}: ${artworkByKey((saved || defaultLoginArt())[c.key])?.label}`).join(' | ')}
        </p>
      </div>
    </Panel>
  )
}
