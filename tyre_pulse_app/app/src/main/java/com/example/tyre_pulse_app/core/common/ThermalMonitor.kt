package com.example.tyre_pulse_app.core.common

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager

/**
 * Agent 43: Prevents phone from shutting down in Saudi/UAE heat.
 * Monitors battery temperature and throttles background sync.
 */
class ThermalMonitor(private val context: Context) {

    fun isDeviceOverheating(): Boolean {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val temp = intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0
        return (temp / 10) > 42 // Threshold 42°C
    }
}
