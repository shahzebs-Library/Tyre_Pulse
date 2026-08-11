package com.example.tyre_pulse_app.core.work

import androidx.work.Constraints
import androidx.work.NetworkType

/**
 * Agent 47: Battery & Network Efficiency.
 */
object WorkUtils {
    val uploadConstraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .setRequiresBatteryNotLow(true) // Don't drain battery if low
        .build()
}
