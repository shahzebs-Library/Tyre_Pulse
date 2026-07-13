/**
 * SignaturePad — a finger-drawn signature capture with no extra native deps.
 *
 * Strokes are captured with PanResponder and rendered live with react-native-svg.
 * On every change it emits a self-contained SVG string (via onChange) that is
 * stored as text and renders anywhere (mobile via SvgXml, web inline / <img>).
 * `null` is emitted when the pad is empty/cleared so callers can treat "unsigned"
 * uniformly.
 */
import React, { useMemo, useRef, useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, PanResponder, StyleSheet, LayoutChangeEvent } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'

type Point = { x: number; y: number }

export interface SignaturePadProps {
  onChange: (svg: string | null) => void
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

export default function SignaturePad({ onChange, height = 180, penColor = '#0f172a', disabled = false }: SignaturePadProps) {
  const [strokes, setStrokes] = useState<Point[][]>([])
  const [current, setCurrent] = useState<Point[]>([])
  const [width, setWidth] = useState(0)
  const widthRef = useRef(0)
  const strokesRef = useRef<Point[][]>([])

  const emit = useCallback((all: Point[][]) => {
    onChange(buildSvg(all, widthRef.current || 1, height, penColor))
  }, [onChange, height, penColor])

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
    onChange(null)
  }

  const hasInk = strokes.length > 0 || current.length > 0

  return (
    <View>
      <View style={[styles.pad, { height }, disabled && styles.padDisabled]} onLayout={onLayout} {...responder.panHandlers}>
        {width > 0 && (
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
            <Text style={styles.placeholderText}>Sign here</Text>
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <View style={styles.baseline} />
        <TouchableOpacity onPress={clear} disabled={!hasInk} style={styles.clearBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="refresh" size={14} color={hasInk ? '#dc2626' : '#cbd5e1'} />
          <Text style={[styles.clearText, { color: hasInk ? '#dc2626' : '#cbd5e1' }]}>Clear</Text>
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
