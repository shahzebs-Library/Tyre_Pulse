/**
 * AdminGuard
 *
 * Component-level RBAC gate for Admin-only subtrees.
 * Renders an "Access Denied" screen if the authenticated user does not hold
 * a role of admin, manager, or director.
 *
 * Usage:
 *   <AdminGuard>
 *     <MyAdminScreen />
 *   </AdminGuard>
 *
 * Note: The admin screens already enforce access via useElevatedGuard() /
 * useAdminGuard() hooks which redirect unauthorised users away. AdminGuard
 * provides an additional declarative layer for screens that cannot use
 * the redirect-based hook (e.g. modal overlays, nested navigators).
 */

import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useAuth } from '../contexts/AuthContext'
import { isAdminOrAbove, UserRole } from '../lib/types'

interface AdminGuardProps {
  children: React.ReactNode
  /**
   * Optional list of allowed roles. Defaults to admin + manager + director.
   * Pass ['admin'] for strict admin-only enforcement.
   */
  allowedRoles?: UserRole[]
}

export function AdminGuard({ children, allowedRoles }: AdminGuardProps) {
  const { profile, loading } = useAuth()
  const router = useRouter()

  // While profile is loading, render nothing (avoids flash of access-denied)
  if (loading) return null

  const role = profile?.role ?? null
  const permitted = allowedRoles
    ? role !== null && allowedRoles.includes(role)
    : isAdminOrAbove(role)

  if (!permitted) {
    return (
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name="shield-outline" size={52} color="#f87171" />
        </View>
        <Text style={styles.title}>Access Denied</Text>
        <Text style={styles.subtitle}>
          This section requires {allowedRoles?.join(' or ') ?? 'Admin, Manager, or Director'} role.
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(app)')}>
          <Ionicons name="home-outline" size={16} color="#fff" />
          <Text style={styles.backBtnText}>Return to Home</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return <>{children}</>
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#f8fafc',
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: 'rgba(248,113,113,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 280,
    marginBottom: 28,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#16a34a',
    paddingHorizontal: 24,
    paddingVertical: 13,
    borderRadius: 14,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  backBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
})
