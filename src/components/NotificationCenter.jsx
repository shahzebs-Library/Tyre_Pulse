/**
 * NotificationCenter.jsx
 * Realtime notification bell with dropdown panel.
 * Severity-coded rows, relative timestamps, individual dismiss, mark-all-read, clear-all.
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell,
  BellRing,
  X,
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  ArrowRight,
  RefreshCw,
  Info,
} from 'lucide-react'
import { useRealtimeAlerts } from '../hooks/useRealtimeAlerts'
import { groupByDay } from '../lib/notifications'

// ─── Severity config ──────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  Critical: {
    border:  'border-red-500',
    bg:      'bg-red-500/10',
    icon:    AlertOctagon,
    iconCls: 'text-red-500',
    badge:   'bg-red-600',
    dot:     'bg-red-500',
  },
  High: {
    border:  'border-orange-500',
    bg:      'bg-orange-500/10',
    icon:    AlertTriangle,
    iconCls: 'text-orange-500',
    badge:   'bg-orange-500',
    dot:     'bg-orange-500',
  },
  Medium: {
    border:  'border-yellow-500',
    bg:      'bg-yellow-500/10',
    icon:    AlertTriangle,
    iconCls: 'text-yellow-500',
    badge:   'bg-yellow-500',
    dot:     'bg-yellow-500',
  },
  Low: {
    border:  'border-blue-500',
    bg:      'bg-blue-500/10',
    icon:    Info,
    iconCls: 'text-blue-500',
    badge:   'bg-blue-500',
    dot:     'bg-blue-500',
  },
}

function getSeverityConfig(severity) {
  return SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.Low
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NotificationRow({ notification, onMarkRead, onDismiss, relativeTime }) {
  const cfg = getSeverityConfig(notification.severity)
  const Icon = cfg.icon

  function handleClick() {
    if (!notification.read) onMarkRead(notification.id)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`
        relative flex gap-3 px-3 py-2.5 border-l-2 cursor-pointer
        transition-colors duration-150
        ${cfg.border}
        ${notification.read ? 'bg-transparent hover:bg-gray-800/40' : `${cfg.bg} hover:bg-gray-800/60`}
      `}
      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      onClick={handleClick}
    >
      {/* Unread indicator dot */}
      {!notification.read && (
        <span className={`absolute top-3 right-8 w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      )}

      {/* Severity icon */}
      <div className="flex-shrink-0 mt-0.5">
        <Icon size={14} className={cfg.iconCls} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold truncate leading-snug ${notification.read ? 'text-gray-400' : 'text-gray-100'}`}>
          {notification.title}
        </p>
        <p className="text-[11px] text-gray-500 leading-snug mt-0.5 line-clamp-2">
          {notification.message}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {notification.assetNo && (
            <span className="text-[10px] font-mono bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
              {notification.assetNo}
            </span>
          )}
          <span className="text-[10px] text-gray-600">
            {relativeTime(notification.timestamp)}
          </span>
        </div>
      </div>

      {/* Dismiss button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(notification.id) }}
        className="flex-shrink-0 self-start mt-0.5 text-gray-700 hover:text-red-400 transition-colors p-0.5 rounded"
        aria-label="Dismiss notification"
      >
        <X size={11} />
      </button>
    </motion.div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 gap-3">
      <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center">
        <Bell size={18} className="text-gray-600" />
      </div>
      <p className="text-xs text-gray-600 text-center">No notifications</p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="px-3 py-3 space-y-3" aria-label="Loading notifications">
      {[0, 1, 2].map(i => (
        <div key={i} className="flex gap-3 animate-pulse">
          <div className="w-4 h-4 rounded bg-gray-800 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 bg-gray-800 rounded w-3/4" />
            <div className="h-2 bg-gray-800/70 rounded w-full" />
            <div className="h-2 bg-gray-800/50 rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 gap-3">
      <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
        <AlertTriangle size={18} className="text-red-400" />
      </div>
      <p className="text-xs text-gray-500 text-center">{message || 'Failed to load notifications'}</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-green-400 transition-colors border border-gray-700/60 rounded-md px-2 py-1"
      >
        <RefreshCw size={11} />
        Retry
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NotificationCenter() {
  const {
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    markRead,
    markAllRead,
    clearAll,
    dismiss,
    relativeTime,
  } = useRealtimeAlerts()

  const [open, setOpen] = useState(false)
  const panelRef  = useRef(null)
  const buttonRef = useRef(null)

  // Close on outside click
  const handleOutsideClick = useCallback((e) => {
    if (
      panelRef.current  && !panelRef.current.contains(e.target) &&
      buttonRef.current && !buttonRef.current.contains(e.target)
    ) {
      setOpen(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick)
    } else {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [open, handleOutsideClick])

  // Close on Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hasCritical = notifications.some(n => n.severity === 'Critical' && !n.read)
  const dayGroups = useMemo(() => groupByDay(notifications), [notifications])

  return (
    <div className="relative flex-shrink-0">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center justify-center w-7 h-7 rounded-md text-gray-700 hover:text-green-400 transition-colors hover:bg-green-400/10"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        title="Notifications"
      >
        {unreadCount > 0
          ? <BellRing size={14} className={hasCritical ? 'text-red-400 animate-pulse' : 'text-orange-400'} />
          : <Bell size={14} />
        }

        {/* Badge */}
        {unreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 min-w-[14px] h-3.5 flex items-center justify-center rounded-full text-[9px] font-bold text-white bg-red-600 px-0.5 leading-none"
            style={{ boxShadow: '0 0 6px rgba(239,68,68,0.7)' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </motion.span>
        )}
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            className="absolute right-0 top-9 w-80 bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl z-50 overflow-hidden"
            style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)' }}
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Top edge accent */}
            <div className="h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(239,68,68,0.5), transparent)' }} />

            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <Bell size={13} className="text-gray-500" />
                <span className="text-xs font-semibold text-gray-200">Notifications</span>
                {unreadCount > 0 && (
                  <span className="text-[10px] bg-red-600/80 text-white rounded-full px-1.5 py-0.5 font-bold leading-none">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-green-400 transition-colors"
                  >
                    <CheckCircle size={11} />
                    Mark all read
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-[11px] text-gray-600 hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {/* Notification list */}
            <div className="max-h-96 overflow-y-auto overflow-x-hidden">
              {loading && notifications.length === 0 ? (
                <LoadingState />
              ) : error && notifications.length === 0 ? (
                <ErrorState message={error} onRetry={refresh} />
              ) : notifications.length === 0 ? (
                <EmptyState />
              ) : (
                dayGroups.map(group => (
                  <div key={group.key}>
                    <div
                      className="sticky top-0 z-10 px-3 py-1 bg-gray-900/95 backdrop-blur-sm text-[10px] font-semibold uppercase tracking-wider text-gray-600"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                    >
                      {group.label}
                    </div>
                    <AnimatePresence initial={false}>
                      {group.items.map(notif => (
                        <NotificationRow
                          key={notif.id}
                          notification={notif}
                          onMarkRead={markRead}
                          onDismiss={dismiss}
                          relativeTime={relativeTime}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
            >
              {notifications.length > 0 ? (
                <span className="text-[10px] text-gray-700">
                  Showing {notifications.length} of {MAX_NOTIFICATIONS_LABEL} max
                </span>
              ) : <span />}
              <Link
                to="/alerts"
                onClick={() => setOpen(false)}
                className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-green-400 transition-colors"
              >
                View all
                <ArrowRight size={11} />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const MAX_NOTIFICATIONS_LABEL = 50
