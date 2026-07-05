package com.tyrepulse.inspector.core.auth

import kotlinx.coroutines.flow.Flow

/**
 * Single entry point for authentication. UI/ViewModels depend on this, not on
 * the concrete Supabase implementation, so identity can move behind the Go API
 * later without touching callers.
 */
class AuthRepository(
    private val authApi: SupabaseAuthApi,
    private val tokenStore: TokenStore,
) {
    /** Emits whether a session token is currently stored. */
    val isSignedIn: Flow<Boolean> = tokenStore.isSignedIn

    /** Sign in and persist the session. Throws ApiException on failure. */
    suspend fun signIn(email: String, password: String) {
        val session = authApi.signInWithPassword(email, password)
        tokenStore.save(session.access_token, session.refresh_token)
    }

    /** Clear the local session. */
    suspend fun signOut() {
        tokenStore.clear()
    }
}
