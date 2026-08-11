package com.example.tyre_pulse_app.core.common

import android.content.Context
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Agent G-05: Data Pruning Engine.
 * Ensures the app doesn't consume excessive device storage.
 */
class StoragePruner(private val context: Context) {
    fun pruneOldPhotos(days: Int = 30) {
        val threshold = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(days.toLong())
        val photoDir = File(context.filesDir, "photos")
        if (photoDir.exists()) {
            photoDir.listFiles()?.forEach { file ->
                if (file.lastModified() < threshold) {
                    file.delete()
                }
            }
        }
    }
}
