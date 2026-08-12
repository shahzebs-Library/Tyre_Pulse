package com.example.tyre_pulse_app.core.network.di

// Using a dedicated config object to store backend constants 
// to avoid BuildConfig resolution issues during development
object NetworkConfig {
    const val BASE_URL = "https://jhssdmeruxtrlqnwfksc.supabase.co/rest/v1/"
    const val SUPABASE_URL = "https://jhssdmeruxtrlqnwfksc.supabase.co/"
    const val SUPABASE_ANON_KEY = "sb_publishable_UDEH7EeHA9S5-NNu4T-9Ug_R60IinrW"
}
