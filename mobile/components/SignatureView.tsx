/**
 * SignatureView — renders a stored signature (the self-contained SVG string
 * produced by SignaturePad) read-only, scaled to fit its container width.
 *
 * Falls back to an honest "no signature" placeholder when the value is empty,
 * and to a plain notice if the stored string isn't valid SVG (e.g. a legacy
 * typed-name capture), so approvers never see a blank or broken box.
 */
import React from 'react'
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native'
import { SvgXml } from 'react-native-svg'

export interface SignatureViewProps {
  value?: string | null
  height?: number
  label?: string
}

// Pull the intrinsic viewBox/size out of the SVG header so we can scale it to
// the available width while preserving aspect ratio.
function svgSize(svg: string): { w: number; h: number } | null {
  const vb = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/)
  if (vb) return { w: Number(vb[1]), h: Number(vb[2]) }
  const w = svg.match(/width="(\d+(?:\.\d+)?)"/)
  const h = svg.match(/height="(\d+(?:\.\d+)?)"/)
  if (w && h) return { w: Number(w[1]), h: Number(h[1]) }
  return null
}

export default function SignatureView({ value, height = 120, label }: SignatureViewProps) {
  const [width, setWidth] = React.useState(0)
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)

  const isSvg = typeof value === 'string' && value.trim().startsWith('<svg')
  const intrinsic = isSvg ? svgSize(value as string) : null
  // Scale the drawing to the box width, capped at `height`.
  const scale = intrinsic && width > 0 ? Math.min(width / intrinsic.w, height / intrinsic.h) : 1
  const drawW = intrinsic ? intrinsic.w * scale : width
  const drawH = intrinsic ? intrinsic.h * scale : height

  return (
    <View style={styles.wrap}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.box, { height }]} onLayout={onLayout}>
        {isSvg && width > 0 ? (
          <SvgXml xml={value as string} width={drawW} height={drawH} />
        ) : value && String(value).trim() ? (
          <Text style={styles.typed}>{String(value)}</Text>
        ) : (
          <Text style={styles.empty}>No signature captured</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: '#334155' },
  box: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', paddingHorizontal: 8,
  },
  typed: { fontSize: 20, fontWeight: '700', color: '#0f172a', fontStyle: 'italic' },
  empty: { fontSize: 12.5, color: '#94a3b8', fontWeight: '600' },
})
