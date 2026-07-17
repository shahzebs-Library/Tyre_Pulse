import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
  StatusBar, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage, Language } from '../../contexts/LanguageContext'

const LANG_OPTIONS: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'ع' },
  { code: 'ur', label: 'اردو' },
]

export default function LoginScreen() {
  const { signIn } = useAuth()
  const { t, language, setLanguage, isRTL } = useLanguage()
  const router = useRouter()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin() {
    if (!identifier.trim() || !password) {
      setError(t('login.errorRequired'))
      return
    }
    setError(null)
    setLoading(true)
    try {
      const { error: signInError } = await signIn(identifier, password)
      if (signInError) {
        // Never surface raw Supabase error strings - they enable user enumeration
        const msg = signInError.message ?? ''
        const isCustom = msg.startsWith('No account found') || msg.startsWith('Account')
        setError(isCustom ? msg : t('login.errorFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  const textAlign = isRTL ? 'right' : 'left'

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
        >
          {/* Logo area */}
          <View style={styles.logoArea}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logoImg}
              resizeMode="contain"
              accessibilityLabel="Tyre Pulse"
            />
            <Text style={styles.appSubtitle}>{t('login.appSubtitle')}</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Language toggle */}
            <View style={styles.langRow}>
              {LANG_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.code}
                  style={[styles.langBtn, language === opt.code && styles.langBtnActive]}
                  onPress={() => setLanguage(opt.code)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.langBtnText, language === opt.code && styles.langBtnTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.cardTitle, { textAlign }]}>{t('login.cardTitle')}</Text>
            <Text style={[styles.cardSubtitle, { textAlign }]}>{t('login.cardSubtitle')}</Text>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
                <Text style={[styles.errorText, { textAlign }]}>{error}</Text>
              </View>
            )}

            {/* Identifier */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('login.identifierLabel')}</Text>
              <View style={[styles.inputWrapper, isRTL && styles.inputWrapperRTL]}>
                <Ionicons name="person-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={identifier}
                  onChangeText={v => { setIdentifier(v); setError(null) }}
                  placeholder={t('login.identifierPlaceholder')}
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  returnKeyType="next"
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('login.passwordLabel')}</Text>
              <View style={[styles.inputWrapper, isRTL && styles.inputWrapperRTL]}>
                <Ionicons name="lock-closed-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1, textAlign }]}
                  value={password}
                  onChangeText={v => { setPassword(v); setError(null) }}
                  placeholder={t('login.passwordPlaceholder')}
                  placeholderTextColor="#94a3b8"
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity onPress={() => setShowPassword(s => !s)} style={styles.eyeBtn}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : (
                  <>
                    <Text style={styles.loginBtnText}>{t('login.signIn')}</Text>
                    <Ionicons name={isRTL ? 'arrow-back' : 'arrow-forward'} size={18} color="#fff" />
                  </>
                )
              }
            </TouchableOpacity>
          </View>

          {/* Register link */}
          <TouchableOpacity
            style={styles.registerLink}
            onPress={() => router.push('/(auth)/register')}
            activeOpacity={0.7}
          >
            <Text style={styles.registerLinkText}>
              Don't have an account?{' '}
              <Text style={styles.registerLinkBold}>Create Account</Text>
            </Text>
          </TouchableOpacity>

          <Text style={styles.footer}>{t('login.tagline')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f0f5f1',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoImg: {
    width: 240,
    height: 132,
    marginBottom: 6,
  },
  appSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    gap: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  langRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 4,
  },
  langBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    minWidth: 52,
    alignItems: 'center',
  },
  langBtnActive: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  langBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  langBtnTextActive: {
    color: '#fff',
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: -12,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#dc2626',
    fontWeight: '500',
  },
  fieldGroup: { gap: 8 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  inputWrapperRTL: {
    flexDirection: 'row-reverse',
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1,
    height: 48,
    fontSize: 15,
    color: '#0f172a',
  },
  eyeBtn: { padding: 4 },
  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16a34a',
    borderRadius: 14,
    height: 52,
    marginTop: 4,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 8,
  },
  registerLink: {
    alignItems: 'center',
    marginTop: 24,
    paddingVertical: 4,
  },
  registerLinkText: {
    fontSize: 14,
    color: '#64748b',
  },
  registerLinkBold: {
    color: '#16a34a',
    fontWeight: '700',
  },
})
