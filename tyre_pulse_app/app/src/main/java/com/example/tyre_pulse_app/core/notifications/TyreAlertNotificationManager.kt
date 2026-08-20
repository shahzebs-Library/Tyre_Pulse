package com.example.tyre_pulse_app.core.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TyreAlertNotificationManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        const val CHANNEL_TYRE = "tyre_alerts"
        const val CHANNEL_MAINTENANCE = "maintenance_alerts"
        const val CHANNEL_SYNC = "sync_status"
    }

    init { createChannels() }

    private fun createChannels() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_TYRE, "Tyre Alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Critical and warning alerts for tyre conditions"
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_MAINTENANCE, "Maintenance Reminders", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Scheduled maintenance and PM due alerts"
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SYNC, "Sync Status", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Background sync progress and results"
            }
        )
    }

    /** Fire a critical tyre alert (tread < 2mm or pressure critical) */
    fun sendCriticalTyreAlert(
        assetNumber: String,
        tyrePosition: String,
        treadDepth: Double? = null,
        pressure: Double? = null
    ) {
        val issue = buildString {
            if (treadDepth != null) append("Tread: %.1f mm".format(treadDepth))
            if (pressure != null) { if (isNotEmpty()) append(" · "); append("Pressure: %.0f PSI".format(pressure)) }
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_TYRE)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Critical Tyre — $assetNumber")
            .setContentText("Position $tyrePosition — $issue — Replace immediately")
            .setStyle(NotificationCompat.BigTextStyle()
                .bigText("Asset $assetNumber · Position $tyrePosition\n$issue\n\nThis tyre requires immediate attention."))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(
                ("critical_$assetNumber$tyrePosition").hashCode(), notification
            )
        } catch (e: SecurityException) { /* permission not granted */ }
    }

    /** Fire a warning when tyre life drops below threshold (e.g. <30%) */
    fun sendTyreLifeWarning(
        assetNumber: String,
        tyrePosition: String,
        remainingLifePercent: Int,
        predictedKmLeft: Int
    ) {
        val notification = NotificationCompat.Builder(context, CHANNEL_TYRE)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Tyre Life Warning — $assetNumber")
            .setContentText("Position $tyrePosition — ${remainingLifePercent}% life (~${predictedKmLeft} km left)")
            .setStyle(NotificationCompat.BigTextStyle()
                .bigText("Asset $assetNumber · Position $tyrePosition\n${remainingLifePercent}% tyre life remaining (~$predictedKmLeft km)\n\nPlan replacement at next service."))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(
                ("warning_$assetNumber$tyrePosition").hashCode(), notification
            )
        } catch (e: SecurityException) { /* permission not granted */ }
    }

    /** Notify when a PM / planned maintenance is due */
    fun sendMaintenanceDue(assetNumber: String, taskName: String, dueDate: String) {
        val notification = NotificationCompat.Builder(context, CHANNEL_MAINTENANCE)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Maintenance Due — $assetNumber")
            .setContentText("$taskName scheduled for $dueDate")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(("pm_$assetNumber").hashCode(), notification)
        } catch (e: SecurityException) { /* permission not granted */ }
    }

    /** Quiet sync result notification */
    fun sendSyncResult(synced: Int, failed: Int) {
        val title = if (failed == 0) "Sync Complete" else "Sync Partial"
        val text = "$synced records synced" + if (failed > 0) ", $failed failed" else ""
        val notification = NotificationCompat.Builder(context, CHANNEL_SYNC)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(99_001, notification)
        } catch (e: SecurityException) { /* permission not granted */ }
    }
}
