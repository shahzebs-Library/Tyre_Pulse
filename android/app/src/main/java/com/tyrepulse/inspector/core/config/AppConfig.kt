package com.tyrepulse.inspector.core.config

import com.tyrepulse.inspector.BuildConfig

/**
 * Resolved runtime configuration. Values are injected at build time from
 * local.properties / CI (see app/build.gradle.kts) — never hard-coded in
 * source. The Supabase anon key is RLS-protected but is still treated as
 * config, not a committed constant.
 */
object AppConfig {
    val supabaseUrl: String = BuildConfig.SUPABASE_URL.trimEnd('/')
    val supabaseAnonKey: String = BuildConfig.SUPABASE_ANON_KEY
    val apiBaseUrl: String = BuildConfig.API_BASE_URL.trimEnd('/')

    /** Supabase auth is required to obtain a session token. */
    val isAuthConfigured: Boolean
        get() = supabaseUrl.isNotBlank() && supabaseAnonKey.isNotBlank()

    /** The Go API is optional until the mobile module is cut over. */
    val isApiConfigured: Boolean
        get() = apiBaseUrl.isNotBlank()
}
