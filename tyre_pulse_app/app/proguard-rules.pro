# TyrePulse Android ProGuard Rules

# 1. SQLCipher (CRITICAL for JNI to work in Release builds)
-keep class net.sqlcipher.** { *; }
-keep class net.sqlcipher.database.** { *; }
-keep class androidx.sqlite.db.** { *; }
-keepclassmembers class net.sqlcipher.database.SQLiteOpenHelper {
    *;
}

# 2. Retrofit and OkHttp
-keepattributes Signature
-keepattributes Exceptions
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}
-keep class retrofit2.** { *; }
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**

# 3. Kotlinx Serialization
-keepattributes *Annotation*, InnerClasses
-keep,allowobfuscation,allowshrinking class *
-keepclassmembers class * {
    @kotlinx.serialization.Serializable *;
}
-keep class kotlinx.serialization.json.** { *; }

# 4. Hilt / Dagger
-keep class dagger.** { *; }
-keep class hilt_aggregated_deps.** { *; }

# 5. Room
-keep class androidx.room.** { *; }
-dontwarn androidx.room.paging.**

# 6. Keep Data Models (To prevent serialization crashes)
-keep class com.example.tyre_pulse_app.core.model.** { *; }
-keep class com.example.tyre_pulse_app.core.network.model.** { *; }

# 7. WorkManager
-keep class androidx.work.** { *; }
-keep class com.example.tyre_pulse_app.feature.inventory.data.InventorySyncWorker { *; }

# 8. Compose
-keep class androidx.compose.** { *; }

# 9. Avoid warnings for ML Kit / Guava
-dontwarn com.google.common.**
-dontwarn com.google.android.gms.**
