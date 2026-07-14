/**
 * ConsoleAuthBridge
 *
 * The System Console runs under its own isolated ConsoleAuthProvider and does
 * NOT expose the main-app useAuth() context. Several main-app admin and
 * access-control pages (MasterAccessControl, PermissionMatrix, SecurityCenter,
 * UserManagement, AiAdministration, OrgHierarchy, HoldingCompany, ...) call
 * useAuth() directly. To host those pages verbatim inside the console, this
 * bridge reads the console auth state and republishes it in the exact shape the
 * main-app AuthContext exposes, so useAuth() resolves normally.
 *
 * The console operator is always a verified super admin (ConsoleGuard enforces
 * is_super_admin before any console route renders), so every capability/
 * permission check resolves to true here.
 */
import { useMemo } from 'react'
import { AuthContext } from '../contexts/AuthContext'
import { useConsoleAuth } from './ConsoleAuthContext'
import { supabase } from '../lib/supabase'

export default function ConsoleAuthBridge({ children }) {
  const consoleAuth = useConsoleAuth()
  const admin = consoleAuth?.admin ?? null
  const consoleSignOut = consoleAuth?.signOut

  const value = useMemo(() => ({
    // Identity
    user: admin ? { id: admin.id, email: admin.email } : null,
    profile: admin,
    loading: false,

    // Access resolution: a console operator is a verified super admin, so every
    // module/capability check passes. These mirror the main-app AuthContext API
    // surface consumed by the hosted pages.
    isSuperAdmin: true,
    hasPermission: () => true,
    hasCapability: () => true,
    grantOverrides: {},
    grantedModules: new Set(),
    modulePerms: {},
    refreshAccess: async () => {},

    // MFA surface (SecurityCenter reads mfaEnabled; the console has its own 2FA
    // flow, so this is a stable placeholder).
    mfaEnabled: true,
    setMfaEnabled: () => {},

    // Auth actions
    signIn: async () => null,
    signOut: consoleSignOut
      ? consoleSignOut
      : async () => { await supabase.auth.signOut() },
  }), [admin, consoleSignOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
