/**
 * Workshop Live Control - technician screen.
 *
 * A technician sees their assigned OPEN jobs and, per job, taps large buttons to
 * record activity (Start / Pause / Resume / Complete / Request Parts /
 * Assistance / Waiting for Approval / Vehicle / Tools / Break / Report Problem)
 * plus shift Check In / Check Out. Every tap writes ONE row to
 * `tech_activity_events` with a server-side timestamp, offline-safe via the
 * typed record queue (WORKSHOP_EVENT). The derived live status is shown per job.
 *
 * Best-effort GPS + site are attached to each event (never blocks the tap).
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  Alert, Platform, KeyboardAvoidingView, Modal, RefreshControl,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme, spacing, radius, typography, elevation, statusColor as themeStatus } from '../../lib/theme'
import { toUserMessage } from '../../lib/safeError'
import { Screen, Badge, Button, EmptyState, ErrorState, Loading } from '../../components/ui'
import PhotoCapture from '../../components/PhotoCapture'
import { captureInspectionLocation } from '../../lib/location'
import {
  TECH_ACTIONS, TechAction, WorkshopStatus, statusFromEvents, statusLabel,
  statusKind, isCheckedIn, myProductivityToday,
} from '../../lib/workshopLive'
import {
  listMyJobs, listMyRecentEvents, listMyEventsToday, listTasksForJob,
  resolveWorkshopPhotos, recordWorkshopEvent, checkIn, checkOut,
  WorkshopJob, WorkshopEvent, WorkshopTask,
} from '../../lib/workshopApi'

// Actions that collect an optional note before recording (a blocked reason or a
// free-form flag). A break needs no note, so it records directly.
function needsNote(a: TechAction): boolean {
  if (a.event === 'report_problem' || a.event === 'request_assistance') return true
  return !!a.reason && a.reason !== 'break'
}

// Actions where a photo helps explain the situation. tech_activity_events has no
// photos column, so an attached photo's storage ref is folded into the event
// note ("Photos: <ref>") - honest, no invented column.
function allowsPhoto(a: TechAction): boolean {
  return a.event === 'report_problem' || a.event === 'request_parts'
}

// Actions that must reference a specific task when the job has been split into
// tasks (the technician picks which step they are starting / completing).
function requiresTask(a: TechAction): boolean {
  return a.event === 'start_job' || a.event === 'complete_task'
}

// Compact minutes -> "45m" / "1h 20m".
function fmtMins(m: number): string {
  const mins = Math.max(0, Math.round(m || 0))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const r = mins % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

// Priority -> semantic pill kind (job cards).
function priorityKind(p: string | null): 'danger' | 'warning' | 'info' | 'neutral' {
  const s = String(p ?? '').toLowerCase()
  if (s.includes('critical') || s.includes('urgent')) return 'danger'
  if (s.includes('high')) return 'warning'
  if (s.includes('med')) return 'info'
  return 'neutral'
}

import { withModuleGuard } from '../../components/ModuleGuard'

export default withModuleGuard(WorkshopScreen, 'workshop')

function WorkshopScreen() {
  const { user, profile, canAccess } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const router = useRouter()

  const allowed = canAccess('workshop')
  const userId = user?.id ?? ''

  // Translate-with-fallback: use the English literal when a key is missing.
  const tf = useCallback((key: string, fallback: string) => {
    const s = t(key)
    return !s || s === key ? fallback : s
  }, [t])

  const [jobs, setJobs] = useState<WorkshopJob[]>([])
  const [events, setEvents] = useState<WorkshopEvent[]>([])
  const [todayEvents, setTodayEvents] = useState<WorkshopEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState<'synced' | 'pending' | null>(null)

  // Tasks for the selected job (wo_tasks) + the picked task.
  const [tasks, setTasks] = useState<WorkshopTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  // A minute-resolution clock so the productivity card advances the running
  // segment without a full reload.
  const [nowTick, setNowTick] = useState<number>(() => Date.now())

  // Note modal (blocked reason / problem / assistance) + optional attached photo.
  const [modalAction, setModalAction] = useState<TechAction | null>(null)
  const [note, setNote] = useState('')
  const [problemPhotos, setProblemPhotos] = useState<string[]>([])

  // Best-effort GPS captured once on mount, reused for every event.
  const gpsRef = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null })

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const todayLabel = new Date().toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })

  // Bounce a user without access.
  useEffect(() => { if (!allowed) router.replace('/') }, [allowed])

  // One best-effort location fix (never blocks).
  useEffect(() => {
    let cancelled = false
    captureInspectionLocation()
      .then((r) => { if (!cancelled && r.status === 'captured' && r.fix) gpsRef.current = { lat: r.fix.gps_lat, lng: r.fix.gps_lng } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return }
    setErrored(false)
    try {
      const [j, e, te] = await Promise.all([
        listMyJobs(userId), listMyRecentEvents(userId), listMyEventsToday(userId),
      ])
      setJobs(j)
      setEvents(e)
      setTodayEvents(te)
      // Keep the current selection if still open, else pick the first job.
      setSelectedJobId((prev) => (prev && j.some((x) => x.id === prev)) ? prev : (j[0]?.id ?? null))
    } catch {
      setErrored(true)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { if (allowed) { setLoading(true); load() } }, [allowed, load])

  // Load the selected job's tasks (if any). A job with no tasks keeps the plain
  // job-level flow. []-degrades if the table is absent.
  useEffect(() => {
    let cancelled = false
    setSelectedTaskId(null)
    if (!selectedJobId) { setTasks([]); return }
    listTasksForJob(selectedJobId)
      .then((t) => { if (!cancelled) setTasks(t) })
      .catch(() => { if (!cancelled) setTasks([]) })
    return () => { cancelled = true }
  }, [selectedJobId])

  // Advance the productivity clock once a minute.
  useEffect(() => {
    const h = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(h)
  }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  // Auto-dismiss the "logged / pending sync" chip.
  useEffect(() => {
    if (!savedFlash) return
    const h = setTimeout(() => setSavedFlash(null), 4000)
    return () => clearTimeout(h)
  }, [savedFlash])

  const checkedIn = useMemo(() => isCheckedIn(events), [events])
  const selectedJob = useMemo(() => jobs.find((j) => j.id === selectedJobId) ?? null, [jobs, selectedJobId])

  // Live status for the selected job (own job events + present flag).
  const jobStatus = useMemo<WorkshopStatus | null>(() => {
    if (!selectedJob) return null
    const jobEvents = events.filter((e) => e.job_id === selectedJob.id)
    return statusFromEvents(jobEvents, { present: checkedIn })
  }, [events, selectedJob, checkedIn])

  // Optimistically append a just-recorded event so the derived status + the
  // productivity card update instantly, then reconcile from the server on the
  // next load/refresh.
  const appendLocal = useCallback((eventType: string, jobId: string | null, reason: string | null, noteText: string | null) => {
    const optimistic: WorkshopEvent = {
      id: `local_${Date.now()}`,
      user_id: userId,
      job_id: jobId,
      asset_no: selectedJob?.asset_no ?? null,
      event_type: eventType,
      reason_code: reason,
      note: noteText,
      at: new Date().toISOString(),
    }
    setEvents((prev) => [...prev, optimistic])
    setTodayEvents((prev) => [...prev, optimistic])
  }, [userId, selectedJob])

  // Compact "my productivity today" rollup from the technician's own events.
  const productivity = useMemo(
    () => myProductivityToday(todayEvents, { now: nowTick }),
    [todayEvents, nowTick],
  )

  const doRecord = useCallback(async (
    a: TechAction | { event: any; reason?: any },
    jobId: string | null,
    noteText: string | null,
    busyLabel: string,
    photoRefs?: string[] | null,
  ) => {
    if (!userId) return
    setBusyKey(busyLabel)
    try {
      const reason = (a as any).reason ?? null
      const res = await recordWorkshopEvent({
        userId,
        eventType: a.event,
        jobId,
        // A job-scoped event carries the picked task (when the job has tasks).
        taskId: jobId ? selectedTaskId : null,
        assetNo: jobId ? (selectedJob?.asset_no ?? null) : null,
        reasonCode: reason,
        note: noteText,
        photoRefs: photoRefs ?? null,
        site: selectedJob?.site ?? profile?.site ?? null,
        country: profile?.country ?? null,
        device: `mobile:${Platform.OS}`,
        gpsLat: gpsRef.current.lat,
        gpsLng: gpsRef.current.lng,
      })
      appendLocal(a.event, jobId, reason, noteText)
      setSavedFlash(res.offline ? 'pending' : 'synced')
    } catch (e: any) {
      Alert.alert(tf('modules.workshop.saveFailTitle', 'Could not record'), toUserMessage(e, tf('modules.workshop.tryAgain', 'Please try again.')))
    } finally {
      setBusyKey(null)
    }
  }, [userId, selectedJob, selectedTaskId, profile, appendLocal, tf])

  // Shift check in / out (no job).
  const onCheckToggle = useCallback(async () => {
    if (!userId || busyKey) return
    setBusyKey('check')
    try {
      const common = {
        userId,
        site: profile?.site ?? null,
        country: profile?.country ?? null,
        device: `mobile:${Platform.OS}`,
        gpsLat: gpsRef.current.lat,
        gpsLng: gpsRef.current.lng,
      }
      const res = checkedIn ? await checkOut(common) : await checkIn(common)
      appendLocal(checkedIn ? 'check_out' : 'check_in', null, null, null)
      setSavedFlash(res.offline ? 'pending' : 'synced')
    } catch (e: any) {
      Alert.alert(tf('modules.workshop.saveFailTitle', 'Could not record'), toUserMessage(e, tf('modules.workshop.tryAgain', 'Please try again.')))
    } finally {
      setBusyKey(null)
    }
  }, [userId, busyKey, checkedIn, profile, appendLocal, tf])

  const closeModal = useCallback(() => { setModalAction(null); setNote(''); setProblemPhotos([]) }, [])

  const onActionPress = useCallback((a: TechAction) => {
    if (busyKey) return
    if (!selectedJob) { Alert.alert(tf('modules.workshop.selectJobTitle', 'Select a job'), tf('modules.workshop.selectJobMsg', 'Pick one of your jobs first.')); return }
    if (!checkedIn) { Alert.alert(tf('modules.workshop.checkInFirstTitle', 'Check in first'), tf('modules.workshop.checkInFirstMsg', 'Check in for your shift before recording work.')); return }

    // When the job is split into tasks, Start / Complete must reference a task.
    if (requiresTask(a) && tasks.length > 0 && !selectedTaskId) {
      Alert.alert(tf('modules.workshop.selectTaskTitle', 'Select a task'), tf('modules.workshop.selectTaskMsg', 'Pick the task you are working on first.'))
      return
    }

    // A completion is significant -> confirm.
    if (a.confirm) {
      Alert.alert(
        tf('modules.workshop.confirmTitle', 'Complete task?'),
        tf('modules.workshop.confirmMsg', 'This records the task as complete and sends it for inspection.'),
        [
          { text: tf('common.cancel', 'Cancel'), style: 'cancel' },
          { text: tf('modules.workshop.actions.complete_task', 'Complete Task'), onPress: () => doRecord(a, selectedJob.id, null, a.key) },
        ],
      )
      return
    }

    // Blocked reasons / problem / assistance -> collect an optional note (+ photo).
    if (needsNote(a)) { setModalAction(a); setNote(''); setProblemPhotos([]); return }

    // Everything else records immediately.
    doRecord(a, selectedJob.id, null, a.key)
  }, [busyKey, selectedJob, checkedIn, tasks, selectedTaskId, doRecord, tf])

  const submitModal = useCallback(async () => {
    if (!modalAction || !selectedJob) { closeModal(); return }
    const a = modalAction
    const n = note.trim() || null
    const photos = problemPhotos
    setModalAction(null)
    // Upload any attached photos (resize/compress inside) to permanent refs; a
    // photo that cannot upload offline is dropped, the event still records.
    let refs: string[] = []
    if (allowsPhoto(a) && photos.length) {
      setBusyKey(a.key)
      try { refs = await resolveWorkshopPhotos(photos) } catch { refs = [] }
    }
    setNote('')
    setProblemPhotos([])
    doRecord(a, selectedJob.id, n, a.key, refs)
  }, [modalAction, selectedJob, note, problemPhotos, doRecord, closeModal])

  const actionLabel = useCallback((a: TechAction) => tf(`modules.workshop.actions.${a.key}`, a.label), [tf])

  if (!allowed) return null

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Nav */}
        <View style={[styles.nav, isRTL && styles.rowR]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.navTitle, { textAlign }]}>{tf('modules.workshop.title', 'My Jobs')}</Text>
            <Text style={[styles.navSub, { textAlign }]}>{todayLabel}</Text>
          </View>
        </View>

        {/* Saved / pending flash */}
        {savedFlash && (
          <View style={[styles.flash, savedFlash === 'pending' ? styles.flashPending : styles.flashSynced, isRTL && styles.rowR]}>
            <Ionicons
              name={savedFlash === 'pending' ? 'cloud-upload-outline' : 'checkmark-circle'}
              size={16}
              color={savedFlash === 'pending' ? theme.color.warning.base : theme.color.success.base}
            />
            <Text style={[styles.flashText, { color: savedFlash === 'pending' ? theme.color.warning.on : theme.color.success.on, textAlign }]}>
              {savedFlash === 'pending' ? tf('modules.workshop.savedPending', 'Saved offline - it will sync automatically') : tf('modules.workshop.savedLogged', 'Activity recorded')}
            </Text>
          </View>
        )}

        {loading ? (
          <Loading label={tf('modules.workshop.loading', 'Loading your jobs...')} />
        ) : errored ? (
          <ErrorState message={tf('modules.workshop.loadError', 'Could not load your jobs.')} onRetry={() => { setLoading(true); load() }} />
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
          >
            {/* Check-in banner */}
            <View style={[styles.checkCard, checkedIn ? styles.checkCardOn : styles.checkCardOff]}>
              <View style={[styles.checkDot, { backgroundColor: checkedIn ? theme.color.success.base : theme.color.neutral.base }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.checkTitle, { textAlign }]}>
                  {checkedIn ? tf('modules.workshop.onDuty', 'On duty') : tf('modules.workshop.offDuty', 'Off duty')}
                </Text>
                <Text style={[styles.checkSub, { textAlign }]} numberOfLines={1}>
                  {profile?.site ? profile.site : tf('modules.workshop.noSite', 'No site set')}
                </Text>
              </View>
              <Button
                label={busyKey === 'check'
                  ? tf('modules.workshop.saving', 'Saving...')
                  : checkedIn ? tf('modules.workshop.checkOut', 'Check Out') : tf('modules.workshop.checkIn', 'Check In')}
                icon={checkedIn ? 'log-out-outline' : 'log-in-outline'}
                variant={checkedIn ? 'secondary' : 'primary'}
                size="sm"
                onPress={onCheckToggle}
                loading={busyKey === 'check'}
                disabled={!!busyKey}
              />
            </View>

            {/* My productivity today */}
            {todayEvents.length > 0 && (
              <View style={styles.prodCard}>
                <View style={[styles.prodHead, isRTL && styles.rowR]}>
                  <Ionicons name="stats-chart-outline" size={16} color={theme.color.primary} />
                  <Text style={[styles.prodTitle, { textAlign }]}>{tf('modules.workshop.myProductivity', 'My day so far')}</Text>
                </View>
                <View style={[styles.prodRow, isRTL && styles.rowR]}>
                  <View style={styles.prodItem}>
                    <Text style={[styles.prodValue, { color: theme.color.success.base }]}>{fmtMins(productivity.productiveMin)}</Text>
                    <Text style={styles.prodLabel} numberOfLines={1}>{tf('modules.workshop.prodProductive', 'Productive')}</Text>
                  </View>
                  <View style={styles.prodItem}>
                    <Text style={[styles.prodValue, { color: theme.color.warning.base }]}>{fmtMins(productivity.blockedMin)}</Text>
                    <Text style={styles.prodLabel} numberOfLines={1}>{tf('modules.workshop.prodBlocked', 'Blocked')}</Text>
                  </View>
                  <View style={styles.prodItem}>
                    <Text style={[styles.prodValue, { color: theme.color.textSecondary }]}>{fmtMins(productivity.unassignedMin)}</Text>
                    <Text style={styles.prodLabel} numberOfLines={1}>{tf('modules.workshop.prodUnassigned', 'Unassigned')}</Text>
                  </View>
                  <View style={styles.prodItem}>
                    <Text style={[styles.prodValue, { color: theme.color.primary }]}>{productivity.jobsCompleted}</Text>
                    <Text style={styles.prodLabel} numberOfLines={1}>{tf('modules.workshop.prodDone', 'Completed')}</Text>
                  </View>
                </View>
              </View>
            )}

            {/* My jobs */}
            <Text style={[styles.sectionLabel, { textAlign }]}>{tf('modules.workshop.myJobs', 'My open jobs')}</Text>
            {jobs.length === 0 ? (
              <EmptyState
                icon="construct-outline"
                title={tf('modules.workshop.noJobsTitle', 'No open jobs')}
                message={tf('modules.workshop.noJobsMsg', 'You have no jobs assigned right now. Pull down to refresh.')}
              />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {jobs.map((job) => {
                  const active = job.id === selectedJobId
                  const jSt = active ? jobStatus : null
                  return (
                    <TouchableOpacity
                      key={job.id}
                      style={[styles.jobCard, active && styles.jobCardActive]}
                      activeOpacity={0.85}
                      onPress={() => setSelectedJobId(active ? null : job.id)}
                    >
                      <View style={[styles.jobHead, isRTL && styles.rowR]}>
                        <View style={styles.jobIcon}>
                          <Ionicons name="car-outline" size={18} color={theme.color.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.jobAsset, { textAlign }]} numberOfLines={1}>
                            {job.asset_no || tf('modules.workshop.noAsset', 'No asset')}
                          </Text>
                          <Text style={[styles.jobMeta, { textAlign }]} numberOfLines={1}>
                            {[
                              job.work_order_no ? `${tf('modules.workshop.wo', 'WO')} ${job.work_order_no}` : null,
                              job.site,
                            ].filter(Boolean).join(' · ') || tf('modules.workshop.noWo', 'No work order number')}
                          </Text>
                        </View>
                        <Ionicons
                          name={active ? 'chevron-up' : (isRTL ? 'chevron-back' : 'chevron-forward')}
                          size={18}
                          color={theme.color.textMuted}
                        />
                      </View>

                      <View style={[styles.jobPills, isRTL && styles.rowR]}>
                        {job.priority ? (
                          <Badge kind={priorityKind(job.priority)}>{job.priority}</Badge>
                        ) : null}
                        {job.target_completion ? (
                          <Badge kind="neutral" icon="time-outline">
                            {new Date(job.target_completion).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}
                          </Badge>
                        ) : null}
                        {jSt ? (
                          <Badge kind={statusKind(jSt)} icon="ellipse">
                            {tf(`modules.workshop.status.${jSt}`, statusLabel(jSt))}
                          </Badge>
                        ) : null}
                      </View>

                      {/* Action panel for the selected job */}
                      {active && (
                        <View style={styles.actionsWrap}>
                          {!checkedIn && (
                            <View style={[styles.hint, isRTL && styles.rowR]}>
                              <Ionicons name="information-circle-outline" size={15} color={theme.color.warning.base} />
                              <Text style={[styles.hintText, { textAlign }]}>{tf('modules.workshop.checkInHint', 'Check in for your shift to enable actions.')}</Text>
                            </View>
                          )}

                          {/* Task picker (only when the job is split into tasks) */}
                          {tasks.length > 0 && (
                            <View style={styles.taskWrap}>
                              <Text style={[styles.taskLabel, { textAlign }]}>{tf('modules.workshop.tasksLabel', 'Tasks')}</Text>
                              <View style={[styles.taskRow, isRTL && styles.rowR]}>
                                {tasks.map((tk) => {
                                  const tActive = tk.id === selectedTaskId
                                  return (
                                    <TouchableOpacity
                                      key={tk.id}
                                      style={[styles.taskChip, tActive && styles.taskChipOn]}
                                      activeOpacity={0.8}
                                      onPress={() => setSelectedTaskId(tActive ? null : tk.id)}
                                    >
                                      <Text style={[styles.taskChipText, tActive && styles.taskChipTextOn]} numberOfLines={1}>
                                        {[tk.seq != null ? `${tk.seq}.` : null, tk.title || tf('modules.workshop.taskUntitled', 'Task')].filter(Boolean).join(' ')}
                                      </Text>
                                      {tk.est_minutes != null ? (
                                        <Text style={[styles.taskChipMeta, tActive && styles.taskChipTextOn]}>{fmtMins(Number(tk.est_minutes))}</Text>
                                      ) : null}
                                    </TouchableOpacity>
                                  )
                                })}
                              </View>
                              <Text style={[styles.taskHint, { textAlign }]}>{tf('modules.workshop.taskHint', 'Pick a task before Start or Complete.')}</Text>
                            </View>
                          )}

                          <View style={styles.actionGrid}>
                            {TECH_ACTIONS.map((a) => {
                              const kind = a.event === 'report_problem' ? 'danger'
                                : a.reason ? 'warning'
                                : a.event === 'complete_task' ? 'success'
                                : 'info'
                              const sc = themeStatus(theme, kind)
                              const isBusy = busyKey === a.key
                              return (
                                <TouchableOpacity
                                  key={a.key}
                                  style={[styles.actionBtn, { backgroundColor: sc.soft, borderColor: sc.base }, (!checkedIn || !!busyKey) && styles.actionBtnOff]}
                                  activeOpacity={0.8}
                                  disabled={!checkedIn || !!busyKey}
                                  onPress={() => onActionPress(a)}
                                >
                                  <Ionicons name={(isBusy ? 'sync-outline' : a.icon) as any} size={22} color={sc.on} />
                                  <Text style={[styles.actionText, { color: sc.on }]} numberOfLines={2}>{actionLabel(a)}</Text>
                                </TouchableOpacity>
                              )
                            })}
                          </View>
                        </View>
                      )}
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* Note modal for blocked reason / problem / assistance (+ optional photo) */}
      <Modal visible={!!modalAction} transparent animationType="fade" onRequestClose={closeModal}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              <Text style={[styles.modalTitle, { textAlign }]}>{modalAction ? actionLabel(modalAction) : ''}</Text>
              {modalAction?.reason ? (
                <Text style={[styles.modalReason, { textAlign }]}>
                  {tf('modules.workshop.reasonLabel', 'Reason')}: {tf(`modules.workshop.reasons.${modalAction.reason}`, modalAction.reason)}
                </Text>
              ) : null}
              <Text style={[styles.modalNoteLabel, { textAlign }]}>
                {tf('modules.workshop.noteLabel', 'Note')} <Text style={styles.optional}>{tf('modules.common.optional', '(optional)')}</Text>
              </Text>
              <TextInput
                style={[styles.modalInput, { textAlign }]}
                value={note}
                onChangeText={setNote}
                placeholder={tf('modules.workshop.notePlaceholder', 'Add any detail for the foreman')}
                placeholderTextColor={theme.color.textMuted}
                multiline
                numberOfLines={3}
                autoFocus
              />
              {modalAction && allowsPhoto(modalAction) ? (
                <View style={{ gap: spacing.xs }}>
                  <Text style={[styles.modalNoteLabel, { textAlign }]}>
                    {tf('modules.workshop.photoLabel', 'Photo')} <Text style={styles.optional}>{tf('modules.common.optional', '(optional)')}</Text>
                  </Text>
                  <PhotoCapture
                    value={problemPhotos}
                    onChange={setProblemPhotos}
                    module="workshop"
                    tint={theme.color.primary}
                    max={3}
                    label={tf('modules.workshop.addPhoto', 'Add Photo')}
                  />
                </View>
              ) : null}
            </ScrollView>
            <View style={[styles.modalBtns, isRTL && styles.rowR]}>
              <Button label={tf('common.cancel', 'Cancel')} variant="ghost" size="md" onPress={closeModal} style={{ flex: 1 }} disabled={!!busyKey} />
              <Button label={tf('modules.workshop.record', 'Record')} icon="checkmark" size="md" onPress={submitModal} style={{ flex: 1 }} disabled={!!busyKey} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    nav: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: c.surface,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    navBack: {
      width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },
    navTitle: { ...typography.title, color: c.text },
    navSub: { ...typography.caption, color: c.textMuted, marginTop: 1 },

    flash: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginHorizontal: spacing.lg, marginTop: spacing.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.md, borderWidth: 1,
    },
    flashSynced: { backgroundColor: c.success.soft, borderColor: c.success.base },
    flashPending: { backgroundColor: c.warning.soft, borderColor: c.warning.base },
    flashText: { ...typography.caption, fontWeight: '800', flex: 1 },

    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md },

    // Check-in banner
    checkCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      borderRadius: radius.lg, padding: spacing.md, borderWidth: 1,
      ...elevation(theme, 1),
    },
    checkCardOn: { backgroundColor: c.success.soft, borderColor: c.success.base },
    checkCardOff: { backgroundColor: c.surface, borderColor: c.border },
    checkDot: { width: 12, height: 12, borderRadius: 6 },
    checkTitle: { ...typography.bodyStrong, color: c.text },
    checkSub: { ...typography.caption, color: c.textMuted, marginTop: 1 },

    // Productivity card
    prodCard: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border, gap: spacing.sm, ...elevation(theme, 1),
    },
    prodHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    prodTitle: { ...typography.label, color: c.textSecondary, textTransform: 'uppercase' },
    prodRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
    prodItem: { flex: 1, alignItems: 'center', gap: 2 },
    prodValue: { ...typography.bodyStrong, fontWeight: '800' },
    prodLabel: { ...typography.micro, color: c.textMuted, textAlign: 'center' },

    sectionLabel: { ...typography.label, color: c.textMuted, textTransform: 'uppercase', marginTop: spacing.xs },

    // Job card
    jobCard: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border, gap: spacing.sm,
      ...elevation(theme, 1),
    },
    jobCardActive: { borderColor: c.primary, borderWidth: 1.5 },
    jobHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    jobIcon: {
      width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.primarySoft,
      alignItems: 'center', justifyContent: 'center',
    },
    jobAsset: { ...typography.bodyStrong, color: c.text },
    jobMeta: { ...typography.caption, color: c.textMuted, marginTop: 1 },
    jobPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },

    // Task picker
    taskWrap: { gap: spacing.xs },
    taskLabel: { ...typography.label, color: c.textMuted, textTransform: 'uppercase' },
    taskRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    taskChip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 7, maxWidth: '100%',
    },
    taskChipOn: { backgroundColor: c.primarySoft, borderColor: c.primary },
    taskChipText: { ...typography.caption, color: c.text, fontWeight: '700', flexShrink: 1 },
    taskChipTextOn: { color: c.primary },
    taskChipMeta: { ...typography.micro, color: c.textMuted, fontWeight: '700' },
    taskHint: { ...typography.micro, color: c.textMuted },

    // Actions
    actionsWrap: { marginTop: spacing.sm, gap: spacing.sm, borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.md },
    hint: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.warning.soft, borderRadius: radius.md, padding: spacing.sm,
    },
    hintText: { ...typography.caption, color: c.warning.on, flex: 1, fontWeight: '700' },
    actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    actionBtn: {
      flexGrow: 1, flexBasis: '30%', minWidth: 100, minHeight: 84,
      borderRadius: radius.md, borderWidth: 1, padding: spacing.sm,
      alignItems: 'center', justifyContent: 'center', gap: 6,
    },
    actionBtnOff: { opacity: 0.45 },
    actionText: { ...typography.micro, fontWeight: '800', textAlign: 'center' },

    // Modal
    optional: { ...typography.caption, color: c.textMuted },
    modalRoot: { flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    modalCard: {
      width: '100%', maxWidth: 420, maxHeight: '85%', backgroundColor: c.surface, borderRadius: radius.lg,
      padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: c.border,
      ...elevation(theme, 3),
    },
    modalTitle: { ...typography.h3, color: c.text },
    modalReason: { ...typography.caption, color: c.textSecondary, fontWeight: '700' },
    modalNoteLabel: { ...typography.label, color: c.textSecondary, marginTop: spacing.xs },
    modalInput: {
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11,
      fontSize: 14, color: c.text, minHeight: 76, textAlignVertical: 'top',
    },
    modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  })
}
