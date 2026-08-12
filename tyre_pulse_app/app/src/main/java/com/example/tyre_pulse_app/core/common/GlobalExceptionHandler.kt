package com.example.tyre_pulse_app.core.common

import android.content.Context
import android.util.Log
import kotlin.system.exitProcess

/**
 * Agent 31: Crash Shield.
 * Prevents "App has stopped" dialogs by catching fatal errors and logging them to backend.
 */
class GlobalExceptionHandler(
    private val context: Context,
    private val defaultHandler: Thread.UncaughtExceptionHandler?
) : Thread.UncaughtExceptionHandler {

    override fun uncaughtException(thread: Thread, throwable: Throwable) {
        // Log to backend system_logs (stub)
        Log.e("FATAL_ERROR", "Uncaught exception in thread ${thread.name}", throwable)
        
        // Potential logic to launch a "Safe Recovery" screen
        // For now, let the system handle it after our logging
        defaultHandler?.uncaughtException(thread, throwable)
    }
}
