import { useEffect, useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { getPendingCount, syncQueue, retryFailed } from '../lib/offlineQueue'
import {
  getPendingRecordCount, syncRecordQueue, retryFailedRecords,
} from '../lib/recordQueue'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { addNetworkStateListener } from 'expo-network'

export default function SyncBanner() {
  const { t } = useLanguage()
  const { theme } = useTheme()
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [online, setOnline] = useState(true)
  const pulse = new Animated.Value(1)

  const refresh = useCallback(async () => {
    // Count BOTH offline queues: inspections and the typed record queue
    // (tyre changes / RCA / issues). Previously only inspections were counted,
    // so users believed everything had synced when record writes had not.
    const [insp, recs] = await Promise.all([getPendingCount(), getPendingRecordCount()])
    setPending(insp + recs)
  }, [])

  const attemptSync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await Promise.all([retryFailed(), retryFailedRecords()])
      await Promise.all([syncQueue(), syncRecordQueue()])
    } finally {
      await refresh()
      setSyncing(false)
    }
  }, [syncing, refresh])

  useEffect(() => {
    refresh()
    const sub = addNetworkStateListener(state => {
      const isOnline = !!state.isConnected && !!state.isInternetReachable
      setOnline(isOnline)
      if (isOnline) attemptSync()
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (pending > 0) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start()
    }
  }, [pending])

  if (pending === 0 && online) return null

  const pendingLabel = pending !== 1
    ? `${pending} ${t('sync.pendingPlural')}`
    : `${pending} ${t('sync.pendingSingle')}`

  const tone = online ? theme.color.success : theme.color.warning

  return (
    <View style={[styles.banner, { backgroundColor: tone.soft, borderBottomColor: tone.base + '33' }]}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Ionicons
          name={online ? 'cloud-upload-outline' : 'cloud-offline-outline'}
          size={16}
          color={tone.base}
        />
      </Animated.View>
      <Text style={[styles.text, { color: tone.on }]}>
        {!online ? t('sync.offline') : pendingLabel}
      </Text>
      {online && pending > 0 && (
        <TouchableOpacity onPress={attemptSync} disabled={syncing}>
          <Text style={[styles.action, { color: theme.color.primaryDark }]}>{syncing ? t('sync.syncing') : t('sync.syncNow')}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  text: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '700',
  },
  action: {
    fontSize: 12.5,
    fontWeight: '800',
  },
})
