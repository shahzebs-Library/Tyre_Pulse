/**
 * Register Screen (invite-only)
 *
 * Public self-registration has been removed for security. Accounts are created
 * by an administrator; new users do NOT self-select a role, organisation or site.
 * This screen is retained as a route so existing links resolve cleanly, and shows
 * an "invite-only" notice that directs the user back to sign in.
 */

import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useLanguage } from '../../contexts/LanguageContext'

export default function RegisterScreen() {
  const router = useRouter()
  const { isRTL } = useLanguage()

  const goToLogin = () => router.replace('/(auth)/login')

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        {/* Logo */}
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logoImg}
          resizeMode="contain"
          accessibilityLabel="Tyre Pulse"
        />

        {/* Invite-only card */}
        <View style={styles.card}>
          <View style={styles.icon}>
            <Ionicons name="shield-checkmark-outline" size={40} color="#16a34a" />
          </View>

          <Text style={styles.title}>Invitation Required</Text>
          <Text style={styles.body}>
            Accounts are created by your administrator. Contact your fleet admin to be invited.
          </Text>

          <TouchableOpacity style={styles.loginBtn} onPress={goToLogin} activeOpacity={0.8}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={18} color="#fff" />
            <Text style={styles.loginBtnText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>TyrePulse | Fleet Management Platform</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  logoImg: { width: 220, height: 120, marginBottom: 28 },

  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  icon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(22,163,74,0.1)',
    borderWidth: 2,
    borderColor: 'rgba(22,163,74,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  body: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 22 },

  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16a34a',
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 28,
    marginTop: 8,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  footer: { textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 28 },
})
