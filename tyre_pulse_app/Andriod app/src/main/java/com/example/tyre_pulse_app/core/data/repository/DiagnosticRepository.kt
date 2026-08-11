package com.example.tyre_pulse_app.core.data.repository

import android.content.Context
import android.os.Build
import com.example.tyre_pulse_app.core.database.dao.SyncDao
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import javax.inject.Inject
import javax.inject.Singleton

data class AppDiagnostics(
    val appVersion: String,
    val buildNumber: Long,
    val environment: String,
    val androidVersion: String,
    val deviceModel: String,
    val pendingSyncCount: Int,
    val failedSyncCount: Int
)

@Singleton
class DiagnosticRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val syncDao: SyncDao
) {
    fun getDiagnostics(): Flow<AppDiagnostics> {
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        val version = packageInfo.versionName ?: "Unknown"
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            packageInfo.versionCode.toLong()
        }

        return combine(
            syncDao.getPendingOperations(),
            syncDao.getFailedCount()
        ) { pending, failedCount ->
            AppDiagnostics(
                appVersion = version,
                buildNumber = code,
                environment = "Development",
                androidVersion = Build.VERSION.RELEASE,
                deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}",
                pendingSyncCount = pending.size,
                failedSyncCount = failedCount
            )
        }
    }
}
