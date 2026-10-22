import { useCallback, useEffect, useState } from 'react'
import { View, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Screen, AppText, BackButton } from '../../../components/ui'
import { useTheme } from '../../../contexts/ThemeContext'
import { supabase } from '../../../lib/supabase'
import { toUserMessage } from '../../../lib/safeError'

type FollowUp = {
  id: string; title: string; recommended_action: string | null;
  due_date: string | null; status: string; assigned_user_id: string | null;
  resolution: string | null; source: string | null
}

export default function AssignedFollowUpScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const taskId = typeof id === 'string' ? id : ''
  const { theme } = useTheme()
  const c = theme.color
  const [item, setItem] = useState<FollowUp | null>(null)
  const [userId, setUserId] = useState('')
  const [resolution, setResolution] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!taskId) { setError('Invalid task link.'); setLoading(false); return }
    setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      const uid = auth.user?.id
      if (!uid) throw new Error('Sign in to access the task.')
      setUserId(uid)
      const { data, error: readError } = await supabase.from('action_items')
        .select('id,title,recommended_action,due_date,status,assigned_user_id,resolution,source')
        .eq('id', taskId).eq('assigned_user_id', uid).maybeSingle()
      if (readError) throw readError
      if (!data) throw new Error('Task not found or not assigned to your account.')
      setItem(data as FollowUp)
      setResolution(data.resolution || '')
    } catch (e) { setError(toUserMessage(e, 'Unable to open assigned task.')) }
    finally { setLoading(false) }
  }, [taskId])
  useEffect(() => { load() }, [load])

  async function transition(next: 'acknowledged' | 'in_progress' | 'blocked' | 'resolved') {
    if (busy || !item || item.assigned_user_id !== userId) return
    if (next === 'resolved' && !resolution.trim()) {
      setError('Describe the completed work before submitting for resolution.')
      return
    }
    if (next === 'blocked' && !reason.trim()) {
      setError('Enter the reason this task is blocked.')
      return
    }
    setBusy(true); setError('')
    try {
      const { data, error: transitionError } = await supabase.rpc('transition_action_item', {
        p_action_item_id: taskId,
        p_to_status: next,
        p_reason: next === 'blocked' ? reason.trim() : null,
        p_resolution: next === 'resolved' ? resolution.trim() : null,
        p_approval_note: null,
      })
      if (transitionError) throw transitionError
      if (data?.ok === false) throw new Error(data.reason || 'Task transition was rejected.')
      await load()
    } catch (e) { setError(toUserMessage(e, 'Task update was not saved.')) }
    finally { setBusy(false) }
  }

  const taskButton = (label: string, status: 'acknowledged' | 'in_progress' | 'blocked' | 'resolved') =>
    <TouchableOpacity key={status} onPress={() => transition(status)} disabled={busy}
      style={[styles.button, { backgroundColor: c.primary, opacity: busy ? 0.5 : 1 }]}>
      <AppText>{label}</AppText>
    </TouchableOpacity>

  return <Screen>
    <ScrollView contentContainerStyle={styles.content}>
      <BackButton />
      <AppText variant="h2">Assigned follow-up</AppText>
      {loading ? <ActivityIndicator color={c.primary} /> : null}
      {error ? <AppText>{error}</AppText> : null}
      {item ? <>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <AppText variant="h3">{item.title}</AppText>
          <AppText>{item.recommended_action || 'Follow up on team communication.'}</AppText>
          <AppText variant="caption" color="muted">Status: {item.status} · Due: {item.due_date || 'Not set'}</AppText>
        </View>
        {['open'].includes(item.status) ? taskButton('Accept assignment', 'acknowledged') : null}
        {['open', 'acknowledged'].includes(item.status) ? taskButton('Start work', 'in_progress') : null}
        {['open', 'acknowledged', 'in_progress'].includes(item.status) ? <>
          <TextInput placeholder="Reason if blocked" placeholderTextColor={c.textMuted}
            value={reason} onChangeText={setReason} multiline
            style={[styles.input, { borderColor: c.border, color: c.text }]} />
          {taskButton('Mark blocked', 'blocked')}
        </> : null}
        {['acknowledged', 'in_progress', 'blocked'].includes(item.status) ? <>
          <AppText variant="body">Completion evidence and resolution notes</AppText>
          <TextInput placeholder="Describe work done, findings, measurements and evidence references"
            placeholderTextColor={c.textMuted} multiline maxLength={4000}
            value={resolution} onChangeText={setResolution}
            style={[styles.input, { borderColor: c.border, color: c.text }]} />
          {taskButton('Submit completed work', 'resolved')}
        </> : null}
        {item.status === 'resolved' ? <AppText>Resolved: {item.resolution || 'Completed'}</AppText> : null}
      </> : null}
    </ScrollView>
  </Screen>
}
const styles = StyleSheet.create({
  content: { padding: 18, gap: 13, paddingBottom: 50 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  input: { borderRadius: 9, borderWidth: 1, minHeight: 65, textAlignVertical: 'top', padding: 12 },
  button: { borderRadius: 9, padding: 13, alignItems: 'center' },
})
