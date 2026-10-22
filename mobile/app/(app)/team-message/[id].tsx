/** Recipient's message details, acknowledgement and reply thread. */
import { useCallback, useEffect, useState } from 'react'
import { View, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Screen, AppText, BackButton } from '../../../components/ui'
import { useTheme } from '../../../contexts/ThemeContext'
import { supabase } from '../../../lib/supabase'
import { toUserMessage } from '../../../lib/safeError'

type Message = { title: string | null; body: string | null; created_at: string }
type Receipt = { acknowledged_at: string | null; read_at: string | null }
type Reply = { id: string; author_id: string; body: string; created_at: string }

export default function TeamMessageDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const messageId = typeof id === 'string' ? id : ''
  const { theme } = useTheme()
  const c = theme.color
  const [message, setMessage] = useState<Message | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [replies, setReplies] = useState<Reply[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [userId, setUserId] = useState('')

  const load = useCallback(async () => {
    if (!messageId) { setError('Invalid message link.'); setLoading(false); return }
    setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!auth.user?.id) throw new Error('Sign in to view this message.')
      setUserId(auth.user.id)
      // Read through the recipient's own notification rather than allowing a
      // broadcast ID to reveal messages outside the authorized audience.
      const { data: notif, error: notifError } = await supabase.from('notifications')
        .select('title,body,created_at').eq('type', 'broadcast')
        .eq('entity_id', messageId).eq('user_id', auth.user.id).maybeSingle()
      if (notifError) throw notifError
      if (!notif) throw new Error('This message is not available to your account.')
      setMessage(notif)
      const { data: rec, error: receiptError } = await supabase.from('broadcast_recipient_receipts')
        .select('read_at,acknowledged_at').eq('broadcast_id', messageId)
        .eq('recipient_id', auth.user.id).maybeSingle()
      if (receiptError) throw receiptError
      setReceipt(rec)
      if (rec && !rec.read_at) {
        const { error: readError } = await supabase.from('broadcast_recipient_receipts')
          .update({ read_at: new Date().toISOString() })
          .eq('broadcast_id', messageId).eq('recipient_id', auth.user.id).is('read_at', null)
        if (readError) throw readError
      }
      const { data: thread, error: threadError } = await supabase.from('broadcast_replies')
        .select('id,author_id,body,created_at').eq('broadcast_id', messageId)
        .order('created_at', { ascending: true }).limit(250)
      if (threadError) throw threadError
      setReplies(thread || [])
    } catch (e) { setError(toUserMessage(e, 'Unable to load team message.')) }
    finally { setLoading(false) }
  }, [messageId])

  useEffect(() => { load() }, [load])

  async function acknowledge() {
    if (!receipt || receipt.acknowledged_at || !userId || busy) return
    setBusy(true); setError('')
    try {
      const at = new Date().toISOString()
      const { error: e } = await supabase.from('broadcast_recipient_receipts')
        .update({ acknowledged_at: at, read_at: at })
        .eq('broadcast_id', messageId).eq('recipient_id', userId).is('acknowledged_at', null)
      if (e) throw e
      setReceipt((old) => old ? { ...old, acknowledged_at: at, read_at: at } : old)
    } catch (e) { setError(toUserMessage(e, 'Unable to acknowledge message.')) }
    finally { setBusy(false) }
  }

  async function submitReply() {
    const body = draft.trim()
    if (!body || body.length > 4000 || busy || !userId) return
    setBusy(true); setError('')
    try {
      const { data, error: e } = await supabase.from('broadcast_replies')
        .insert({ broadcast_id: messageId, author_id: userId, body })
        .select('id,author_id,body,created_at').single()
      if (e) throw e
      setReplies((old) => [...old, data])
      setDraft('')
    } catch (e) { setError(toUserMessage(e, 'Unable to send reply.')) }
    finally { setBusy(false) }
  }

  return <Screen>
    <ScrollView contentContainerStyle={styles.content}>
      <BackButton />
      <AppText variant="h2">Team message</AppText>
      {loading ? <ActivityIndicator color={c.primary} /> : null}
      {error ? <AppText color="danger">{error}</AppText> : null}
      {message ? <>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <AppText variant="h3">{message.title || 'Team communication'}</AppText>
          <AppText variant="body">{message.body || ''}</AppText>
          <AppText variant="caption" color="muted">{new Date(message.created_at).toLocaleString()}</AppText>
        </View>
        <TouchableOpacity disabled={busy || !!receipt?.acknowledged_at || !receipt}
          onPress={acknowledge} style={[styles.button, { backgroundColor: c.primary, opacity: busy || receipt?.acknowledged_at ? 0.55 : 1 }]}>
          <AppText>{receipt?.acknowledged_at ? 'Acknowledged' : 'Acknowledge message'}</AppText>
        </TouchableOpacity>
        <AppText variant="h3">Replies</AppText>
        {replies.length === 0 ? <AppText color="muted">No replies yet.</AppText> : null}
        {replies.map(r => <View key={r.id} style={[styles.card, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <AppText variant="body">{r.body}</AppText>
          <AppText variant="caption" color="muted">{r.author_id === userId ? 'You' : 'Team member'} · {new Date(r.created_at).toLocaleString()}</AppText>
        </View>)}
        <TextInput multiline maxLength={4000} value={draft} onChangeText={setDraft} placeholder="Write a reply"
          placeholderTextColor={c.textMuted} style={[styles.input, { borderColor: c.border, color: c.text }]} />
        <TouchableOpacity onPress={submitReply} disabled={busy || !draft.trim()} style={[styles.button, { backgroundColor: c.primary, opacity: busy || !draft.trim() ? 0.55 : 1 }]}>
          <AppText>Send reply</AppText>
        </TouchableOpacity>
      </> : null}
    </ScrollView>
  </Screen>
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 14, paddingBottom: 50 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 9 },
  button: { borderRadius: 9, padding: 13, alignItems: 'center' },
  input: { borderRadius: 9, borderWidth: 1, padding: 12, minHeight: 75, textAlignVertical: 'top' },
})
