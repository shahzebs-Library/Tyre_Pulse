package com.example.tyre_pulse_app.core.common

import android.content.Context
import com.example.tyre_pulse_app.R

/**
 * Agent Sec-3: Sanitizes technical errors to hide internal table names and URLs.
 */
object ProductionErrorHandler {
    fun getFriendlyMessage(error: Throwable): String {
        val message = error.message ?: ""
        
        return when {
            message.contains("supabase", ignoreCase = true) -> "Service temporarily unavailable. Please try later."
            message.contains("404") || message.contains("table") -> "Data record not found. Please contact support."
            message.contains("401") || message.contains("403") -> "Session expired. Please login again."
            message.contains("timeout") || message.contains("connect") -> "Connection weak. Check your internet."
            else -> "A system error occurred. We are looking into it."
        }
    }
}
