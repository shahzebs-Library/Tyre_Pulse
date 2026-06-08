/**
 * useRealtimeAlerts.js
 * Supabase Realtime subscription for critical tyre alerts.
 * Monitors tyre_records (INSERT/UPDATE) and alerts (INSERT) tables.
 * Persists notifications to localStorage with a 50-item ring buffer.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'tp_realtime_notifications'
const MAX_NOTIFICATIONS = 50

// Severity thresholds
const CRITICAL_TREAD  = 2      // mm
const CRITICAL_PRESSURE_VAR = 30  // %

export const SEVERITY_COLORS = {
  Critical: 'red-500',
  High:     'orange-500',
  Medium:   'yellow-500',
  Low:      'blue-500',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(notifications) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications))
  } catch {
    // Storage quota exceeded — silently ignore
  }
}

function ringBuffer(existing, incoming) {
  const merged = [incoming, ...existing]
  return merged.slice(0, MAX_NOTIFICATIONS)
}

function relativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function classifyTyreRecord(record) {
  const tread   = parseFloat(record.tread_depth)
  const pressVar = parseFloat(record.pressure_variance)
  const risk    = (record.risk_level || '').toLowerCase()

  if (risk === 'critical' || tread <= CRITICAL_TREAD) {
    return {
      severity: 'Critical',
      type:     'tyre_critical',
      title:    `Critical Tyre — ${record.asset_no || 'Unknown Asset'}`,
      message:  tread <= CRITICAL_TREAD
        ? `Tread depth ${tread}mm on ${record.brand || 'unknown brand'} (${record.serial_no || 'no serial'}) — immediate action required.`
        : `Risk level Critical on ${record.brand || 'unknown brand'} (${record.serial_no || 'no serial'}).`,
      assetNo: record.asset_no || null,
    }
  }

  if (pressVar >= CRITICAL_PRESSURE_VAR) {
    return {
      severity: 'High',
      type:     'pressure_variance',
      title:    `Pressure Variance Alert — ${record.asset_no || 'Unknown Asset'}`,
      message:  `Pressure variance of ${pressVar}% detected on ${record.brand || 'unknown brand'} (${record.serial_no || 'no serial'}).`,
      assetNo: record.asset_no || null,
    }
  }

  if (risk === 'high') {
    return {
      severity: 'High',
      type:     'tyre_high_risk',
      title:    `High Risk Tyre — ${record.asset_no || 'Unknown Asset'}`,
      message:  `High risk tyre detected: ${record.brand || 'unknown brand'} (${record.serial_no || 'no serial'}) at site ${record.site || 'unknown'}.`,
      assetNo: record.asset_no || null,
    }
  }

  return null
}

function buildNotification({ id, type, title, message, severity, assetNo }) {
  return {
    id:        id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    title,
    message,
    severity,
    assetNo,
    timestamp: new Date().toISOString(),
    read:      false,
  }
}

function buildAlertNotification(alertRecord) {
  const severityMap = {
    critical: 'Critical',
    high:     'High',
    medium:   'Medium',
    low:      'Low',
    info:     'Low',
  }
  const severity = severityMap[(alertRecord.severity || '').toLowerCase()] || 'Medium'

  return buildNotification({
    id:       `alert-${alertRecord.id || Date.now()}`,
    type:     alertRecord.type || 'alert',
    title:    alertRecord.title || 'Fleet Alert',
    message:  alertRecord.message || alertRecord.description || 'A new alert has been raised.',
    severity,
    assetNo:  alertRecord.asset_no || alertRecord.meta?.assetNo || null,
  })
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useRealtimeAlerts() {
  const [notifications, setNotifications] = useState(() => loadPersisted())
  const channelRef = useRef(null)

  // Persist whenever notifications change
  useEffect(() => {
    persist(notifications)
  }, [notifications])

  const addNotification = useCallback((notif) => {
    setNotifications(prev => ringBuffer(prev, notif))
  }, [])

  // Subscribe to Supabase Realtime
  useEffect(() => {
    // Build a single channel for both tables
    const channel = supabase
      .channel('tp-realtime-alerts', {
        config: { broadcast: { self: false } },
      })

      // tyre_records — INSERT
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tyre_records' },
        ({ new: record }) => {
          const classified = classifyTyreRecord(record)
          if (!classified) return
          addNotification(
            buildNotification({
              ...classified,
              id: `tyre-insert-${record.id || Date.now()}`,
            })
          )
        }
      )

      // tyre_records — UPDATE
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tyre_records' },
        ({ new: record }) => {
          const classified = classifyTyreRecord(record)
          if (!classified) return
          addNotification(
            buildNotification({
              ...classified,
              id: `tyre-update-${record.id || Date.now()}`,
            })
          )
        }
      )

      // alerts — INSERT
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts' },
        ({ new: alertRecord }) => {
          addNotification(buildAlertNotification(alertRecord))
        }
      )

      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[useRealtimeAlerts] Channel error — will retry automatically.')
        }
      })

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [addNotification])

  // ── Actions ────────────────────────────────────────────────────────────────

  const markRead = useCallback((id) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    )
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  const clearAll = useCallback(() => {
    setNotifications([])
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }, [])

  const dismiss = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  return {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    clearAll,
    dismiss,
    relativeTime,
    SEVERITY_COLORS,
  }
}
