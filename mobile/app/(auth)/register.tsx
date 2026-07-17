/**
 * Register Screen
 *
 * Self-service account creation for field staff.
 * Creates a Supabase Auth user + pending profile row (approved: false).
 * Admin must approve in User Management before the account activates.
 */

import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
  StatusBar, Alert, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
import { useLanguage, Language } from '../../contexts/LanguageContext'

const LANG_OPTIONS: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'ع' },
  { code: 'ur', label: 'اردو' },
]

// Roles available for self-registration (management roles created by admin only)
const SELECTABLE_ROLES = [
  { db: 'Inspector',  label: 'Inspector',  desc: 'Conducts tyre inspections' },
  { db: 'Tyre Man',   label: 'Tyre Man',   desc: 'Workshop tyre technician' },
  { db: 'Reporter',   label: 'Reporter',   desc: 'Reports accidents & incidents' },
  { db: 'Driver',     label: 'Driver',     desc: 'Vehicle driver / operator' },
]

type Step = 'form' | 'pending'

export default function RegisterScreen() {
  const router = useRouter()
  const { t, language, setLanguage, isRTL } = useLanguage()

  const [step, setStep]             = useState<Step>('form')
  const [fullName, setFullName]     = useState('')
  const [username, setUsername]     = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [phone, setPhone]           = useState('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [role, setRole]             = useState(SELECTABLE_ROLES[0].db)
  const [site, setSite]             = useState('')
  const [sites, setSites]           = useState<string[]>([])
  const [showPass, setShowPass]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const textAlign = isRTL ? 'right' : 'left'

  // Fetch available sites from fleet so user picks from known sites
  useEffect(() => {
    supabase
      .from('vehicle_fleet')
      .select('site')
      .then(({ data }) => {
        if (data) {
          const unique = [...new Set(data.map(r => r.site).filter(Boolean))] as string[]
          setSites(unique.sort())
        }
      })
  }, [])

  function validate(): string | null {
    if (!fullName.trim())        return 'Full name is required.'
    if (username.trim().length < 3) return 'Username must be at least 3 characters.'
    if (!/^[a-zA-Z0-9._-]+$/.test(username.trim())) return 'Username may only contain letters, numbers, and . _ -'
    if (!employeeId.trim())      return 'Employee ID is required.'
    if (password.length < 8)    return 'Password must be at least 8 characters.'
    if (password !== confirm)    return 'Passwords do not match.'
    if (!site.trim())            return 'Please enter your site / work location.'
    return null
  }

  async function handleRegister() {
    const err = validate()
    if (err) { setError(err); return }
    setError(null)
    setLoading(true)

    try {
      const uname = username.trim()
      const empId = employeeId.trim()
      // Match the web: users sign up with a username + Employee ID, not an email.
      // Supabase Auth still needs an email, so we mint a synthetic, non-routable
      // address from the username (identical slug logic to the web app). A DB
      // trigger (V82) auto-confirms it; login resolves username / Employee ID
      // back to this address via get_email_by_identifier.
      const slug = uname.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/(^\.+|\.+$)/g, '') || 'user'
      const syntheticEmail = `${slug}@users.tyrepulse.app`

      // 1. Create Supabase Auth user
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: syntheticEmail,
        password,
        options: {
          data: {
            username: uname,
            full_name: fullName.trim() || null,
            employee_id: empId,
            region: 'KSA',
          },
        },
      })

      if (authErr) {
        const taken = /already registered|already been registered|duplicate|already exists|database error/i.test(authErr.message || '')
        setError(taken ? 'That username or Employee ID is already taken. Please choose another.' : toUserMessage(authErr))
        return
      }

      const userId = authData.user?.id
      if (!userId) {
        setError('Registration failed - no user ID returned. Please try again.')
        return
      }

      // 2. Upsert the pending profile with the mobile-specific fields (role/site).
      //    A DB trigger already created the base row (username, employee_id,
      //    approved:false); this stamps the chosen role and site.
      const { error: profileErr } = await supabase.from('profiles').upsert({
        id:          userId,
        full_name:   fullName.trim(),
        username:    uname,
        employee_id: empId,
        email:       syntheticEmail,
        phone:       phone.trim() || null,
        role,
        site:        site.trim(),
        approved:    false,
      }, { onConflict: 'id' })

      if (profileErr) {
        // Profile update failed - log (dev only, production logcat is world-
        // readable) but still show success since the auth user and its
        // trigger-created profile exist.
        if (__DEV__) console.warn('Profile upsert failed:', profileErr.message)
      }

      setStep('pending')
    } catch (e: any) {
      setError(toUserMessage(e, 'An unexpected error occurred.'))
    } finally {
      setLoading(false)
    }
  }

  // ── Pending approval screen ───────────────────────────────────────────────────
  if (step === 'pending') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
        <View style={styles.pendingContainer}>
          <View style={styles.pendingIcon}>
            <Ionicons name="hourglass-outline" size={40} color="#f59e0b" />
          </View>
          <Text style={styles.pendingTitle}>Registration Submitted!</Text>
          <Text style={styles.pendingBody}>
            Your account has been created and is pending admin approval.{'\n\n'}
            You will be able to sign in once an administrator approves your account.
          </Text>
          <View style={styles.pendingCard}>
            <Row label="Name"        value={fullName} />
            <Row label="Username"    value={username} />
            <Row label="Employee ID" value={employeeId} />
            <Row label="Role"        value={role} />
            <Row label="Site"        value={site} />
          </View>
          <TouchableOpacity style={styles.goLoginBtn} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.goLoginText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Registration form ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo + header */}
          <View style={styles.logoArea}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logoImg}
              resizeMode="contain"
              accessibilityLabel="Tyre Pulse"
            />
            <Text style={styles.appSubtitle}>Create your account</Text>
          </View>

          <View style={styles.card}>
            {/* Language toggle */}
            <View style={styles.langRow}>
              {LANG_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.code}
                  style={[styles.langBtn, language === opt.code && styles.langBtnActive]}
                  onPress={() => setLanguage(opt.code)}
                >
                  <Text style={[styles.langBtnText, language === opt.code && styles.langBtnTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.cardTitle, { textAlign }]}>Create Account</Text>
            <Text style={[styles.cardSubtitle, { textAlign }]}>
              Fill in your details below. Your account will be reviewed by an admin before activation.
            </Text>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
                <Text style={[styles.errorText, { textAlign }]}>{error}</Text>
              </View>
            )}

            {/* Full Name */}
            <Field label="Full Name *" textAlign={textAlign}>
              <View style={[styles.inputWrapper, isRTL && styles.inputWrapperRTL]}>
                <Ionicons name="person-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={fullName}
                  onChangeText={v => { setFullName(v); setError(null) }}
                  placeholder="e.g. Mohammed Ali"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>
            </Field>

            {/* Username */}
            <Field label="Username *" textAlign={textAlign}>
              <View style={[styles.inputWrapper, isRTL && styles.inputWrapperRTL]}>
                <Ionicons name="at-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={username}
                  onChangeText={v => { setUsername(v); setError(null) }}
                  placeholder="e.g. mohammed.ali"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>
            </Field>

            {/* Employee ID */}
            <Field label="Employee ID *" textAlign={textAlign}>
              <View style={[styles.inputWrapper, isRTL && styles.inputWrapperRTL]}>
                <Ionicons name="id-card-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={employeeId}
                  onChangeText={v => { setEmployeeId(v); setError(null) }}
                  placeholder="e.g. EMP-1042"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>
            </Field>

            {/* Phone (optional) */}
            <Field label="Phone Number (optional)" textAlign={textAlign}>
              <View style={[styles.inputWrapper, isRTL && styles.inputWrapperRTL]}>
                <Ionicons name="call-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+966 5xxxxxxxx"
                  placeholderTextColor="#94a3b8"
                  keyboardType="phone-pad"
                  returnKeyType="next"
                />
              </View>
            </Field>

            {/* Password */}
            <Field label="Password *" textAlign={textAlign}>
              <View style={[styles.inputWrapper, isRTL && styles.inputWrapperRTL]}>
                <Ionicons name="lock-closed-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1, textAlign }]}
                  value={password}
                  onChangeText={v => { setPassword(v); setError(null) }}
                  placeholder="Min. 8 characters"
                  placeholderTextColor="#94a3b8"
                  secureTextEntry={!showPass}
                  returnKeyType="next"
                />
                <TouchableOpacity onPress={() => setShowPass(s => !s)} style={styles.eyeBtn}>
                  <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color="#94a3b8" />
                </TouchableOpacity>
              </View>
              {/* Password strength indicator */}
              {password.length > 0 && (
                <StrengthBar password={password} />
              )}
            </Field>

            {/* Confirm Password */}
            <Field label="Confirm Password *" textAlign={textAlign}>
              <View style={[styles.inputWrapper, isRTL && styles.inputWrapperRTL]}>
                <Ionicons name="lock-closed-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1, textAlign }]}
                  value={confirm}
                  onChangeText={v => { setConfirm(v); setError(null) }}
                  placeholder="Re-enter password"
                  placeholderTextColor="#94a3b8"
                  secureTextEntry={!showConfirm}
                  returnKeyType="next"
                />
                <TouchableOpacity onPress={() => setShowConfirm(s => !s)} style={styles.eyeBtn}>
                  <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color="#94a3b8" />
                </TouchableOpacity>
              </View>
              {confirm.length > 0 && password !== confirm && (
                <Text style={styles.mismatch}>Passwords do not match</Text>
              )}
            </Field>

            {/* Role selection */}
            <Field label="Your Role *" textAlign={textAlign}>
              <View style={styles.roleGrid}>
                {SELECTABLE_ROLES.map(r => (
                  <TouchableOpacity
                    key={r.db}
                    style={[styles.roleChip, role === r.db && styles.roleChipActive]}
                    onPress={() => setRole(r.db)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.roleChipLabel, role === r.db && styles.roleChipLabelActive]}>
                      {r.label}
                    </Text>
                    <Text style={[styles.roleChipDesc, role === r.db && styles.roleChipDescActive]}>
                      {r.desc}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>

            {/* Site / Location */}
            <Field label="Site / Work Location *" textAlign={textAlign}>
              {sites.length > 0 ? (
                <>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.siteScroll}
                    contentContainerStyle={{ gap: 8, paddingRight: 4 }}
                  >
                    {sites.map(s => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.siteChip, site === s && styles.siteChipActive]}
                        onPress={() => setSite(s)}
                      >
                        <Text style={[styles.siteChipText, site === s && styles.siteChipTextActive]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={styles.siteOrLabel}>- or type your site -</Text>
                </>
              ) : null}
              <View style={[styles.inputWrapper, isRTL && styles.inputWrapperRTL]}>
                <Ionicons name="location-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={site}
                  onChangeText={setSite}
                  placeholder="e.g. Riyadh, Site A, Camp 3"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={handleRegister}
                />
              </View>
            </Field>

            {/* Info note */}
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color="#3b82f6" />
              <Text style={styles.infoText}>
                Your account will be pending until an administrator reviews and approves it. You will not be able to sign in until approved.
              </Text>
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : (
                  <>
                    <Text style={styles.submitBtnText}>Create Account</Text>
                    <Ionicons name={isRTL ? 'arrow-back' : 'arrow-forward'} size={18} color="#fff" />
                  </>
                )
              }
            </TouchableOpacity>

            {/* Back to login */}
            <TouchableOpacity style={styles.backToLogin} onPress={() => router.back()}>
              <Text style={styles.backToLoginText}>Already have an account? Sign In</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>TyrePulse · Fleet Management Platform</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function Field({ label, textAlign, children }: { label: string; textAlign: 'left' | 'right'; children: React.ReactNode }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { textAlign }]}>{label}</Text>
      {children}
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.pendingRow}>
      <Text style={styles.pendingRowLabel}>{label}</Text>
      <Text style={styles.pendingRowValue}>{value}</Text>
    </View>
  )
}

function StrengthBar({ password }: { password: string }) {
  const score = Math.min(
    (password.length >= 8 ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0),
    4
  )
  const labels  = ['Too weak', 'Weak', 'Fair', 'Strong', 'Very strong']
  const colors  = ['#dc2626', '#f97316', '#f59e0b', '#16a34a', '#15803d']
  return (
    <View style={styles.strengthRow}>
      <View style={styles.strengthBars}>
        {[1, 2, 3, 4].map(i => (
          <View
            key={i}
            style={[styles.strengthSeg, { backgroundColor: i <= score ? colors[score] : '#e2e8f0' }]}
          />
        ))}
      </View>
      <Text style={[styles.strengthLabel, { color: colors[score] }]}>{labels[score]}</Text>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: '#f0f5f1' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 12 },

  logoArea:    { alignItems: 'center', marginBottom: 28 },
  logoImg:     { width: 220, height: 120, marginBottom: 4 },
  appSubtitle: { fontSize: 13, color: '#64748b', marginTop: 4, fontWeight: '500' },

  card: { backgroundColor: '#fff', borderRadius: 20, padding: 24, gap: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 16, elevation: 4, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },

  langRow:         { flexDirection: 'row', gap: 8, justifyContent: 'center', paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', marginBottom: 4 },
  langBtn:         { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0', minWidth: 52, alignItems: 'center' },
  langBtnActive:   { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  langBtnText:     { fontSize: 13, fontWeight: '700', color: '#64748b' },
  langBtnTextActive: { color: '#fff' },

  cardTitle:    { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  cardSubtitle: { fontSize: 13, color: '#64748b', marginTop: -10, lineHeight: 19 },

  errorBox:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)', borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 13, color: '#dc2626', fontWeight: '500' },

  fieldGroup: { gap: 7 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 },

  inputWrapper:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 12 },
  inputWrapperRTL: { flexDirection: 'row-reverse' },
  inputIcon:       { marginRight: 8 },
  input:           { flex: 1, height: 48, fontSize: 15, color: '#0f172a' },
  eyeBtn:          { padding: 4 },

  mismatch: { fontSize: 12, color: '#dc2626', marginTop: 4 },

  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  strengthBars:{ flexDirection: 'row', gap: 4, flex: 1 },
  strengthSeg: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel:{ fontSize: 11, fontWeight: '600' },

  roleGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleChip:           { flex: 1, minWidth: '47%', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, padding: 12, backgroundColor: '#f8fafc', gap: 3 },
  roleChipActive:     { borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.07)' },
  roleChipLabel:      { fontSize: 13, fontWeight: '700', color: '#374151' },
  roleChipLabelActive:{ color: '#16a34a' },
  roleChipDesc:       { fontSize: 11, color: '#94a3b8' },
  roleChipDescActive: { color: '#16a34a' },

  siteScroll:         { marginBottom: 8 },
  siteChip:           { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  siteChipActive:     { borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.07)' },
  siteChipText:       { fontSize: 13, fontWeight: '600', color: '#64748b' },
  siteChipTextActive: { color: '#16a34a' },
  siteOrLabel:        { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginBottom: 6 },

  infoBox:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(59,130,246,0.06)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)', borderRadius: 10, padding: 12 },
  infoText: { flex: 1, fontSize: 12, color: '#3b82f6', lineHeight: 18 },

  submitBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#16a34a', borderRadius: 14, height: 52, marginTop: 4, shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },

  backToLogin:     { alignItems: 'center', paddingTop: 4 },
  backToLoginText: { fontSize: 13, color: '#64748b', fontWeight: '500' },

  footer: { textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 28 },

  // Pending screen
  pendingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  pendingIcon:      { width: 80, height: 80, borderRadius: 24, backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 2, borderColor: 'rgba(245,158,11,0.3)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  pendingTitle:     { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 12, textAlign: 'center' },
  pendingBody:      { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  pendingCard:      { width: '100%', backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3, marginBottom: 28 },
  pendingRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pendingRowLabel:  { fontSize: 12, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  pendingRowValue:  { fontSize: 14, color: '#0f172a', fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  goLoginBtn:       { backgroundColor: '#16a34a', borderRadius: 14, height: 50, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center', shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  goLoginText:      { color: '#fff', fontSize: 15, fontWeight: '700' },
})
