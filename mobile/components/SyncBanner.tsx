import { useEffect, useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { getPendingCount, syncQueue, retryFailed } from '../lib/offlineQueue'
import {
  getPendingRecordCount, syncRecordQueue, retryFailedRecords,
} from '../lib/recordQueue'
import { useLanguage } from '../contexts/LanguageContext'
import { addNetworkStateListener } from 'expo-network'

export default function SyncBanner() {
  const { t } = useLanguage()
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

  return (
    <View style={[styles.banner, !online && styles.bannerOffline]}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Ionicons
          name={online ? 'cloud-upload-outline' : 'cloud-offline-outline'}
          size={16}
          color={online ? '#16a34a' : '#f59e0b'}
        />
      </Animated.View>
      <Text style={[styles.text, !online && styles.textOffline]}>
        {!online ? t('sync.offline') : pendingLabel}
      </Text>
      {online && pending > 0 && (
        <TouchableOpacity onPress={attemptSync} disabled={syncing}>
          <Text style={styles.action}>{syncing ? t('sync.syncing') : t('sync.syncNow')}</Text>
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
    backgroundColor: 'rgba(22,163,74,0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(22,163,74,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannerOffline: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderBottomColor: 'rgba(245,158,11,0.25)',
  },
  text: {
    flex: 1,
    fontSize: 12,
    color: '#15803d',
    fontWeight: '500',
  },
  textOffline: {
    color: '#b45309',
  },
  action: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16a34a',
  },
})
