package com.example.tyre_pulse_app.core.database

import android.content.Context
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import net.sqlcipher.database.SQLiteDatabase
import net.sqlcipher.database.SupportFactory

/**
 * Agent 34: Room Encryption.
 * Uses SQLCipher to encrypt the local database.
 */
object SecuritySupport {
    fun getEncryptionFactory(context: Context): SupportFactory {
        val passphrase = SQLiteDatabase.getBytes("TP-Secure-Pulse-Key-2025".toCharArray())
        return SupportFactory(passphrase)
    }
}
