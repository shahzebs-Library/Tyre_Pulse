/**
 * SignaturePad — a finger-drawn signature capture with no extra native deps.
 *
 * Strokes are captured with PanResponder and rendered live with react-native-svg.
 * On every change it emits a self-contained SVG string (via onChange) that is
 * stored as text and renders anywhere (mobile via SvgXml, web inline / <img>).
 * `null` is emitted when the pad is empty/cleared so callers can treat "unsigned"
 * uniformly.
 *
 * IT IS NOW CONTROLLED-CAPABLE (`value`), AND THAT IS A BUG FIX, NOT A FEATURE.
 * The pad kept its strokes in local state only, so a caller that stores the SVG
 * and unmounts the pad - which is exactly what a bottom sheet does - reopened it
 * BLANK even though the answer was signed. The operator then either re-signed
 * (overwriting a good signature) or pressed Clear, which emitted `null` and
 * ERASED the stored signature they had only come back to look at. Passing the
 * stored SVG back in re-hydrates the real strokes, so reopening shows what was
 * signed and Clear means what it says.
 *
 * Re-hydration parses the `d` attributes of OUR OWN emitted SVG (plain M/L
 * point lists) back into strokes, so Clear and further drawing keep working on
 * a restored signature. A signature we cannot parse (produced elsewhere) is
 * still shown, read-only, via SvgXml rather than being silently dropped -
 * showing a blank pad over a real signature is the failure this fixes.
 */
import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { View, Text, TouchableOpacity, PanResponder, StyleSheet, LayoutChangeEvent } from 'react-native'
import Svg, { Path, SvgXml } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { useLanguage } from '../contexts/LanguageContext'

type Point = { x: number; y: number }

export interface SignaturePadProps {
  onChange: (svg: string | null) => void
  /**
   * The currently stored signature SVG, if any. Supply it whenever the pad can
   * be unmounted and reopened (sheets, modals, tabs) so the operator sees their
   * own signature instead of an empty pad.
   */
  value?: string | null
  height?: number
  penColor?: string
  disabled?: boolean
}

const STROKE_WIDTH = 2.5

function pointsToPath(points: Point[]): string {
  if (!points.length) return ''
  const [first, ...rest] = points
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`
  for (const p of rest) d += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  return d
}

function buildSvg(strokes: Point[][], width: number, height: number, color: string): string | null {
  const paths = strokes.filter((s) => s.length > 0)
  if (!paths.length) return null
  const body = paths
    .map((s) => `<path d="${pointsToPath(s)}" fill="none" stroke="${color}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">${body}</svg>`
}

/**
 * Read strokes back out of an SVG this pad produced. Returns [] for anything it
 * cannot read, which the caller treats as "show it read-only" rather than
 * "there is no signature".
 */
export function parseSignatureStrokes(svg: string | null | undefined): Point[][] {
  if (typeof svg !== 'string' || !svg) return []
  const out: Point[][] = []
  const pathRe = /\sd="([^"]*)"/g
  let path: RegExpExecArray | null
  while ((path = pathRe.exec(svg)) !== null) {
    const pts: Point[] = []
    const ptRe = /[ML]\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/g
    let pt: RegExpExecArray | null
    while ((pt = ptRe.exec(path[1])) !== null) {
      const x = Number(pt[1])
      const y = Number(pt[2])
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y })
    }
    if (pts.length) out.push(pts)
  }
  return out
}

export default function SignaturePad({
  onChange, value = null, height = 180, penColor = '#0f172a', disabled = false,
}: SignaturePadProps) {
  const { t } = useLanguage()
  const [strokes, setStrokes] = useState<Point[][]>(() => parseSignatureStrokes(value))
  const [current, setCurrent] = useState<Point[]>([])
  const [width, setWidth] = useState(0)
  const widthRef = useRef(0)
  const strokesRef = useRef<Point[][]>(parseSignatureStrokes(value))
  // The last SVG WE emitted. Comparing against it stops the pad re-hydrating
  // from the value it just produced, which would fight the operator's pen.
  const emittedRef = useRef<string | null>(value ?? null)
  // A stored signature we could not parse: render it read-only rather than
  // pretending the field is unsigned.
  const [foreignSvg, setForeignSvg] = useState<string | null>(() =>
    value && parseSignatureStrokes(value).length === 0 ? value : null)

  const emit = useCallback((all: Point[][]) => {
    const svg = buildSvg(all, widthRef.current || 1, height, penColor)
    emittedRef.current = svg
    onChange(svg)
  }, [onChange, height, penColor])

  // Re-hydrate whenever the caller hands us a signature we did not just emit
  // (reopening a signed item, switching between items in one sheet).
  useEffect(() => {
    const next = value ?? null
    if (next === emittedRef.current) return
    emittedRef.current = next
    const parsed = parseSignatureStrokes(next)
    strokesRef.current = parsed
    setStrokes(parsed)
    setCurrent([])
    setForeignSvg(next && parsed.length === 0 ? next : null)
  }, [value])

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent
          setCurrent([{ x: locationX, y: locationY }])
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent
          setCurrent((prev) => [...prev, { x: locationX, y: locationY }])
        },
        onPanResponderRelease: () => {
          setCurrent((stroke) => {
            if (stroke.length) {
              const next = [...strokesRef.current, stroke]
              strokesRef.current = next
              setStrokes(next)
              setForeignSvg(null)
              emit(next)
            }
            return []
          })
        },
      }),
    [disabled, emit],
  )

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    widthRef.current = w
    setWidth(w)
  }

  const clear = () => {
    strokesRef.current = []
    setStrokes([])
    setCurrent([])
    setForeignSvg(null)
    emittedRef.current = null
    onChange(null)
  }

  const hasInk = strokes.length > 0 || current.length > 0 || !!foreignSvg

  return (
    <View>
      <View style={[styles.pad, { height }, disabled && styles.padDisabled]} onLayout={onLayout} {...responder.panHandlers}>
        {width > 0 && !!foreignSvg && (
          <SvgXml xml={foreignSvg} width={width} height={height} />
        )}
        {width > 0 && !foreignSvg && (
          <Svg width={width} height={height}>
            {strokes.map((s, i) => (
              <Path key={i} d={pointsToPath(s)} fill="none" stroke={penColor} strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {current.length > 0 && (
              <Path d={pointsToPath(current)} fill="none" stroke={penColor} strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
            )}
          </Svg>
        )}
        {!hasInk && (
          <View style={styles.placeholder} pointerEvents="none">
            <Ionicons name="create-outline" size={18} color="#94a3b8" />
            <Text style={styles.placeholderText}>{t('signature.signHere')}</Text>
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <View style={styles.baseline} />
        <TouchableOpacity onPress={clear} disabled={!hasInk} style={styles.clearBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="refresh" size={14} color={hasInk ? '#dc2626' : '#cbd5e1'} />
          <Text style={[styles.clearText, { color: hasInk ? '#dc2626' : '#cbd5e1' }]}>{t('common.clear')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pad: {
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  padDisabled: { opacity: 0.5 },
  placeholder: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6 },
  placeholderText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 10 },
  baseline: { flex: 1 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  clearText: { fontSize: 13, fontWeight: '700' },
})
