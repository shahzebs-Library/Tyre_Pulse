/**
 * A signature on a mobile approval screen, with the person's own saved mark
 * already in it.
 *
 * MOBILE MIRROR of `src/components/checklist/SignatureField.jsx`. The two write
 * the same `user_signatures` row, so a supervisor who saves their mark on the
 * phone finds it waiting on the web and the other way round.
 *
 * WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT. Before V601 every
 * approval asked the approver to redraw their signature from nothing. This loads
 * the mark they saved earlier so they do not have to.
 *
 * PRE-FILLING IS NOT SIGNING. The saved mark is loaded into the field and it is
 * SHOWN - as the actual drawing, under a line that says it is the saved one -
 * and nothing is recorded until the person presses the approve button their
 * parent screen owns. A signature that appeared without being visible would be
 * indistinguishable from the app signing on someone's behalf.
 *
 * CHANGING IT IS ALWAYS ONE TAP AWAY. "Draw a new signature" replaces the pad,
 * and a switch decides whether that new mark also becomes the remembered one.
 * The switch starts ON for a person who has never saved one (that is the point
 * of drawing it) and OFF for someone who already has one, because a one-off
 * signature for a single sheet must not silently overwrite the mark they chose.
 *
 * There is no second pad here: the drawing is still `SignaturePad`, so the
 * stored format does not change.
 */
import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator } from 'react-native'
import SignaturePad from './SignaturePad'
import SignatureView from './SignatureView'
import { normaliseSignature } from '../lib/savedSignature'
import { getMySignature, saveMySignature } from '../lib/userSignature'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'

export interface SignatureFieldProps {
  /** The mark to attach to the decision, or null when there is none yet. */
  onChange: (signature: string | null) => void
  label?: string
  height?: number
  penColor?: string
}

export default function SignatureField({
  onChange, label, height = 170, penColor,
}: SignatureFieldProps) {
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const c = theme.color
  const textAlign = isRTL ? 'right' : 'left'

  const [saved, setSaved] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [drawing, setDrawing] = React.useState(false)
  const [remember, setRemember] = React.useState(true)
  const [note, setNote] = React.useState<string | null>(null)

  // onChange is called from an effect and from handlers; a ref keeps a caller's
  // inline arrow from re-running the load effect on every render.
  const emit = React.useRef(onChange)
  emit.current = onChange

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      const mark = await getMySignature()
      if (cancelled) return
      setSaved(mark)
      // Someone who already has a mark is not trying to replace it by default.
      setRemember(!mark)
      setLoading(false)
      // Load it into the decision, but ONLY as a value the screen can see -
      // the parent still has to be told to approve.
      if (mark) emit.current(mark)
    })()
    return () => { cancelled = true }
  }, [])

  const onDraw = React.useCallback(async (value: string | null) => {
    const mark = normaliseSignature(value)
    emit.current(mark)
    if (!mark || !remember) return
    try {
      await saveMySignature(mark)
      setSaved(mark)
      setNote(t('signatureField.remembered'))
    } catch {
      // Failing to remember must never block the approval in front of them.
      setNote(t('signatureField.notRemembered'))
    }
  }, [remember, t])

  const startRedraw = () => {
    setDrawing(true)
    // The old mark is no longer what will be attached, so stop offering it as
    // though it were - leaving it attached while the pad reads empty is how a
    // stale signature reaches a decision nobody meant to sign with it.
    emit.current(null)
  }

  if (loading) {
    return (
      <View style={[s.box, { borderColor: c.border, backgroundColor: c.surface }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    )
  }

  // A saved mark, not yet replaced: show it and offer the redraw.
  if (saved && !drawing) {
    return (
      <View>
        <Text style={[s.hint, { color: c.textMuted, textAlign }]}>
          {t('signatureField.usingSaved')}
        </Text>
        <View style={[s.box, { borderColor: c.border, backgroundColor: c.surface }]}>
          <SignatureView value={saved} height={height - 40} />
        </View>
        <TouchableOpacity onPress={startRedraw} style={s.linkRow} activeOpacity={0.7}>
          <Text style={[s.link, { color: c.primary, textAlign }]}>
            {t('signatureField.drawNew')}
          </Text>
        </TouchableOpacity>
        {note ? <Text style={[s.hint, { color: c.textMuted, textAlign }]}>{note}</Text> : null}
      </View>
    )
  }

  return (
    <View>
      {label ? <Text style={[s.hint, { color: c.textMuted, textAlign }]}>{label}</Text> : null}
      <SignaturePad value={null} onChange={onDraw} height={height} penColor={penColor} />
      <View style={[s.rememberRow, isRTL && s.rowRtl]}>
        <Switch
          value={remember}
          onValueChange={setRemember}
          trackColor={{ true: c.primary, false: c.border }}
        />
        <Text style={[s.rememberLabel, { color: c.text, textAlign }]}>
          {saved ? t('signatureField.replaceSaved') : t('signatureField.rememberThis')}
        </Text>
      </View>
      {note ? <Text style={[s.hint, { color: c.textMuted, textAlign }]}>{note}</Text> : null}
    </View>
  )
}

const s = StyleSheet.create({
  box: {
    borderWidth: 1, borderRadius: 12, padding: 8,
    alignItems: 'center', justifyContent: 'center', minHeight: 80,
  },
  hint: { fontSize: 12, marginBottom: 6, marginTop: 6 },
  linkRow: { paddingVertical: 10 },
  link: { fontSize: 14, fontWeight: '600' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  rowRtl: { flexDirection: 'row-reverse' },
  rememberLabel: { fontSize: 13, flexShrink: 1 },
})
