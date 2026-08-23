package com.example.tyre_pulse_app.core.network.di

import com.example.tyre_pulse_app.BuildConfig

/**
 * Backend endpoints and the publishable key, taken from the build.
 *
 * WHAT THIS REPLACED. These were three hard-coded constants. build.gradle.kts goes
 * to real trouble to read SUPABASE_ANON_KEY_DEV / _PROD out of local.properties and
 * expose them per product flavour as BuildConfig fields - and none of it was used,
 * because the values were pinned here instead. The practical effect was that the
 * `dev` flavour ran against the PRODUCTION key and the PRODUCTION project, so there
 * was no separation between environments at all.
 *
 * `val`, not `const val`: a const has to be a compile-time literal, and these now
 * come from BuildConfig.
 *
 * The anon key is publishable by design - it ships inside every APK and the real
 * boundary is row-level security - so reading it from BuildConfig is about correct
 * environment separation, not about hiding a secret.
 */
object NetworkConfig {
    /** PostgREST. Every table API is mounted here, so paths must NOT repeat /rest/v1/. */
    val BASE_URL: String = BuildConfig.BASE_URL

    /** Project root. Auth (/auth/v1) and Storage (/storage/v1) live here, not under /rest/v1/. */
    val SUPABASE_URL: String = BuildConfig.SUPABASE_URL

    val SUPABASE_ANON_KEY: String = BuildConfig.SUPABASE_ANON_KEY
}
