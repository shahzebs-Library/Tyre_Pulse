/**
 * Admin AI Chat
 *
 * Mobile interface to the same multi-agent AI system as the web app.
 * Calls the existing `chat-ai` Supabase Edge Function.
 * 4 agents: Analyst · Tyre Engineer · QA Data · Planner
 * Context-aware: pre-loads fleet summary before first message.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  View, Text, ScrollView, FlatList, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { toUserMessage } from '../../../lib/safeError'
import { useElevatedGuard } from '../../../hooks/useRoleGuard'

// ── Agent definitions ─────────────────────────────────────────────────────────

type AgentKey = 'analyst' | 'engineer' | 'qa' | 'planner'

const AGENTS: Record<AgentKey, {
  label: string; icon: string; color: string; bg: string
  system: string; placeholder: string
}> = {
  analyst: {
    label: 'Analyst', icon: 'bar-chart-outline', color: '#3b82f6', bg: '#eff6ff',
    placeholder: 'Ask about KPIs, cost trends, fleet performance...',
    system: `You are TyrePulse's Fleet Analyst Agent. You analyse fleet KPIs, tyre cost trends,
site comparisons, and operational metrics. Provide concise, actionable insights.
Format your answers with clear headings and bullet points. Be data-driven.`,
  },
  engineer: {
    label: 'Tyre Engineer', icon: 'construct-outline', color: '#f59e0b', bg: '#fffbeb',
    placeholder: 'Ask about tyre failures, wear patterns, pressure issues...',
    system: `You are TyrePulse's Tyre Engineer Agent. You diagnose tyre failures, analyse wear patterns,
root causes of pressure loss, alignment issues, and overloading. Always:
1. State the root cause
2. List contributing factors
3. Give a risk level (Low / Medium / High / Critical)
4. Provide corrective actions
5. Suggest prevention measures`,
  },
  qa: {
    label: 'QA Data', icon: 'shield-outline', color: '#8b5cf6', bg: '#f5f3ff',
    placeholder: 'Ask about data quality, duplicates, anomalies...',
    system: `You are TyrePulse's QA Data Agent. You identify data quality issues, duplicate entries,
anomalous readings, inconsistent serials, and suspicious values in fleet data.
Flag each issue clearly with: Issue Type · Severity · Recommended Fix.`,
  },
  planner: {
    label: 'Planner', icon: 'calendar-outline', color: '#10b981', bg: '#f0fdf4',
    placeholder: 'Ask about maintenance schedules, budgets, forecasts...',
    system: `You are TyrePulse's Fleet Planner Agent. You forecast tyre replacements,
maintenance schedules, budget requirements, and procurement needs.
Provide specific timelines, quantities, and cost estimates where possible.`,
  },
}

const SUGGESTIONS: Record<AgentKey, string[]> = {
  analyst:  ['What is the CPK by site?', 'Which site has the highest tyre cost?', 'Show me this month\'s KPIs'],
  engineer: ['Why are tyres failing at high rate?', 'What causes premature tyre wear?', 'Analyze pressure compliance'],
  qa:       ['Are there duplicate tyre serials?', 'Flag anomalous pressure readings', 'Check data quality issues'],
  planner:  ['Which vehicles need tyres in 30 days?', 'What is the quarterly tyre budget?', 'Plan next month\'s replacements'],
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  agent?: AgentKey
  loading?: boolean
}

export default function AiChatScreen() {
  const { allowed, loading: guardLoading } = useElevatedGuard()
  const { profile } = useAuth()
  const router = useRouter()

  const [agent, setAgent]       = useState<AgentKey>('analyst')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const [context, setContext]   = useState('')
  const scrollRef = useRef<FlatList<Message>>(null)

  // Pre-load fleet context once
  useEffect(() => {
    if (!allowed) return

    async function buildContext() {
      try {
        const [accRes, alertRes, inspRes] = await Promise.all([
          supabase.from('accidents').select('severity, status, site').limit(200),
          supabase.from('alerts').select('severity').eq('resolved', false).eq('is_active', true),
          supabase.from('inspections').select('status, site').limit(200),
        ])
        const accs  = accRes.data ?? []
        const alts  = alertRes.data ?? []
        const insps = inspRes.data ?? []

        const open    = accs.filter(a => a.status !== 'closed').length
        const fatal   = accs.filter(a => a.severity === 'fatal').length
        const severe  = accs.filter(a => a.severity === 'severe').length

        setContext(
          `FLEET CONTEXT (live data):\n` +
          `- Total accidents: ${accs.length} | Open: ${open} | Fatal: ${fatal} | Severe: ${severe}\n` +
          `- Active alerts: ${alts.length}\n` +
          `- Total inspections: ${insps.length}\n` +
          `- Admin user: ${profile?.full_name ?? 'Admin'} | Role: ${profile?.role}\n`
        )
      } catch (e) {
        // Context is best-effort; the chat still works without it.
        if (__DEV__) console.warn('[ai-chat] context build failed', e)
        setContext(`- Admin user: ${profile?.full_name ?? 'Admin'} | Role: ${profile?.role}\n`)
      }
    }
    buildContext()
  }, [allowed, profile?.full_name, profile?.role])

  if (guardLoading || !allowed) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#4c1d95" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#7c3aed" />
        </View>
      </SafeAreaView>
    )
  }

  async function send(text?: string) {
    const q = (text ?? input).trim()
    if (!q || sending) return
    setInput('')

    const userMsg: Message = { role: 'user', content: q }
    const placeholder: Message = { role: 'assistant', content: '', agent, loading: true }
    setMessages(prev => [...prev, userMsg, placeholder])
    setSending(true)
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)

    const cfg = AGENTS[agent]
    const systemPrompt = `${cfg.system}\n\n${context}`
    const userPrompt   = messages.length === 0
      ? `Context: ${context}\n\nQuestion: ${q}`
      : q

    try {
      const { data, error } = await supabase.functions.invoke('chat-ai', {
        body: {
          system:     systemPrompt,
          user:       userPrompt,
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 1200,
        },
      })
      let reply: string
      if (error) {
        // Surface the function's real error (e.g. missing API key)
        let detail = toUserMessage(error)
        try { const body = await (error as any).context?.json?.(); if (body?.error) detail = body.error } catch { /* keep */ }
        reply = `AI unavailable: ${detail}`
      } else {
        reply = (data as any)?.error ? `AI unavailable: ${(data as any).error}` : ((data as any)?.content ?? 'No response.')
      }
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: reply, agent },
      ])
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: 'Network error. Please try again.', agent },
      ])
    } finally {
      setSending(false)
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)
    }
  }

  function clearChat() {
    setMessages([])
  }

  const cfg = AGENTS[agent]

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#4c1d95" />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>TyrePulse AI</Text>
          <Text style={styles.headerSub}>{cfg.label} Agent active</Text>
        </View>
        {messages.length > 0 && (
          <TouchableOpacity onPress={clearChat} style={styles.clearBtn}>
            <Ionicons name="trash-outline" size={16} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Agent selector ─────────────────────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.agentScroll}
        contentContainerStyle={styles.agentRow}
      >
        {(Object.entries(AGENTS) as [AgentKey, typeof AGENTS[AgentKey]][]).map(([key, a]) => (
          <TouchableOpacity
            key={key}
            style={[styles.agentChip, { borderColor: a.color + '40' }, agent === key && { backgroundColor: a.color, borderColor: a.color }]}
            onPress={() => setAgent(key)}
          >
            <Ionicons name={a.icon as any} size={13} color={agent === key ? '#fff' : a.color} />
            <Text style={[styles.agentChipText, { color: agent === key ? '#fff' : a.color }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* ── Messages ─────────────────────────────────────────────────────── */}
        <FlatList
          ref={scrollRef}
          style={styles.messageScroll}
          contentContainerStyle={styles.messageContent}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={11}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => { if (messages.length > 0) scrollRef.current?.scrollToEnd({ animated: true }) }}
          ListEmptyComponent={
            <View style={styles.welcome}>
              <View style={[styles.welcomeIcon, { backgroundColor: cfg.bg }]}>
                <Ionicons name={cfg.icon as any} size={28} color={cfg.color} />
              </View>
              <Text style={styles.welcomeTitle}>{cfg.label} Agent</Text>
              <Text style={styles.welcomeSub}>{cfg.placeholder}</Text>
              <View style={styles.suggestionGrid}>
                {SUGGESTIONS[agent].map((sg, i) => (
                  <TouchableOpacity key={i} style={styles.suggestion} onPress={() => send(sg)}>
                    <Text style={styles.suggestionText}>{sg}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          }
          renderItem={({ item: msg }) => (
            <View style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
              {msg.role === 'assistant' && (
                <View style={[styles.agentAvatar, { backgroundColor: AGENTS[msg.agent ?? 'analyst'].bg }]}>
                  <Ionicons name={AGENTS[msg.agent ?? 'analyst'].icon as any} size={13} color={AGENTS[msg.agent ?? 'analyst'].color} />
                </View>
              )}
              <View style={[styles.bubbleInner, msg.role === 'user' ? styles.bubbleInnerUser : styles.bubbleInnerAi]}>
                {msg.loading
                  ? <ActivityIndicator size="small" color={cfg.color} />
                  : <Text style={[styles.bubbleText, msg.role === 'user' && styles.bubbleTextUser]}>
                      {msg.content}
                    </Text>
                }
              </View>
            </View>
          )}
        />

        {/* ── Input bar ────────────────────────────────────────────────────── */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={cfg.placeholder}
            placeholderTextColor="#94a3b8"
            multiline
            maxLength={1000}
            onSubmitEditing={() => send()}
            returnKeyType="send"
            blurOnSubmit
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: cfg.color }, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => send()}
            disabled={!input.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={16} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#f8f5ff' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#4c1d95',
    paddingHorizontal: 16, paddingVertical: 12, gap: 10,
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  clearBtn:{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#fff' },
  headerSub:   { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 },

  // Agent selector
  agentScroll: { backgroundColor: '#fff', maxHeight: 54 },
  agentRow:    { paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  agentChip:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, backgroundColor: '#fff' },
  agentChipText: { fontSize: 12, fontWeight: '700' },

  // Messages
  messageScroll:   { flex: 1 },
  messageContent:  { padding: 16, gap: 12, paddingBottom: 8 },

  welcome: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  welcomeIcon:   { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  welcomeTitle:  { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  welcomeSub:    { fontSize: 13, color: '#64748b', textAlign: 'center', paddingHorizontal: 20 },
  suggestionGrid:{ gap: 8, width: '100%', marginTop: 8 },
  suggestion:    { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  suggestionText:{ fontSize: 13, color: '#374151', fontWeight: '500' },

  // Bubbles
  bubble:         { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleUser:     { justifyContent: 'flex-end' },
  bubbleAi:       { justifyContent: 'flex-start' },
  agentAvatar:    { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  bubbleInner:    { maxWidth: '82%', borderRadius: 16, padding: 12 },
  bubbleInnerUser:{ backgroundColor: '#4c1d95', borderBottomRightRadius: 4 },
  bubbleInnerAi:  { backgroundColor: '#fff', borderBottomLeftRadius: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  bubbleText:     { fontSize: 13, color: '#374151', lineHeight: 20 },
  bubbleTextUser: { color: '#fff' },

  // Input
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f1f5f9',
  },
  input: {
    flex: 1, backgroundColor: '#f8fafc', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 13, color: '#0f172a', maxHeight: 100,
    borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  sendBtn:         { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
})
