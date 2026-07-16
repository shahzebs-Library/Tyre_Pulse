/**
 * SkeletonLoader - pulsing placeholder boxes for any layout shape.
 * Use instead of ActivityIndicator for content-aware loading states.
 * Theme-aware (light/dark) via useTheme.
 */

import { useRef, useEffect } from 'react'
import { Animated, View, StyleSheet, ViewStyle } from 'react-native'
import { useTheme } from '../contexts/ThemeContext'
import { radius as R, spacing } from '../lib/theme'

interface SkeletonBoxProps {
  width?: number
  widthPct?: string
  height: number
  radius?: number
  style?: ViewStyle
}

export function SkeletonBox({ width, widthPct = '100%', height, radius = 8, style }: SkeletonBoxProps) {
  const { theme } = useTheme()
  const opacity = useRef(new Animated.Value(0.35)).current

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.75, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])

  return (
    <Animated.View
      style={[{
        width: width !== undefined ? width : widthPct as any,
        height, borderRadius: radius, backgroundColor: theme.color.surfaceSunken, opacity,
      }, style]}
    />
  )
}

// ── Prebuilt skeleton layouts ────────────────────────────────────────────────

function useCardStyle() {
  const { theme } = useTheme()
  return {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderWidth: 1,
  }
}

export function SkeletonStatRow() {
  const card = useCardStyle()
  return (
    <View style={sk.statRow}>
      {[0, 1, 2].map(i => (
        <View key={i} style={[sk.statCard, card]}>
          <SkeletonBox height={26} width={40} radius={6} />
          <SkeletonBox height={11} width={55} radius={4} style={{ marginTop: 6 }} />
        </View>
      ))}
    </View>
  )
}

export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  const card = useCardStyle()
  return (
    <View style={[sk.card, card]}>
      <View style={sk.cardRow}>
        <SkeletonBox width={40} height={40} radius={10} />
        <View style={{ flex: 1, gap: 8 }}>
          {Array.from({ length: lines }).map((_, i) => (
            <SkeletonBox key={i} height={13} widthPct={i === 0 ? '70%' : '50%'} radius={4} />
          ))}
        </View>
      </View>
    </View>
  )
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </View>
  )
}

export function SkeletonKpiGrid({ cols = 4 }: { cols?: number }) {
  const card = useCardStyle()
  return (
    <View style={sk.kpiGrid}>
      {Array.from({ length: cols }).map((_, i) => (
        <View key={i} style={[sk.kpiCard, card]}>
          <SkeletonBox width={20} height={20} radius={4} />
          <SkeletonBox height={22} width={36} radius={5} style={{ marginTop: 6 }} />
          <SkeletonBox height={10} width={48} radius={4} style={{ marginTop: 4 }} />
        </View>
      ))}
    </View>
  )
}

const sk = StyleSheet.create({
  statRow: { flexDirection: 'row', gap: spacing.md },
  statCard: {
    flex: 1, borderRadius: R.lg, padding: spacing.lg,
    alignItems: 'center',
  },
  card: {
    borderRadius: R.md, padding: spacing.lg,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kpiGrid: { flexDirection: 'row', gap: 8 },
  kpiCard: {
    flex: 1, borderRadius: R.md, padding: 10,
    alignItems: 'center',
  },
})
