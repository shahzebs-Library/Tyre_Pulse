package com.example.tyre_pulse_app.core.database

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import net.sqlcipher.database.SQLiteDatabase
import net.sqlcipher.database.SupportFactory
import java.util.UUID

/**
 * Security Hardening: Room Encryption.
 * Uses SQLCipher to encrypt the local database with a dynamic passphrase
 * generated on first launch and stored securely in EncryptedSharedPreferences.
 */
object SecuritySupport {
    fun getEncryptionFactory(context: Context): SupportFactory {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        val securePrefs = EncryptedSharedPreferences.create(
            context,
            "secure_db_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )

        var pass = securePrefs.getString("db_key", null)
        if (pass == null) {
            pass = UUID.randomUUID().toString()
            securePrefs.edit().putString("db_key", pass).apply()
        }

        val passphrase = SQLiteDatabase.getBytes(pass.toCharArray())
        return SupportFactory(passphrase)
    }
}
