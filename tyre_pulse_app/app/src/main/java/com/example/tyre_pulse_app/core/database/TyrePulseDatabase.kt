package com.example.tyre_pulse_app.core.database

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.example.tyre_pulse_app.core.database.dao.*
import com.example.tyre_pulse_app.core.database.model.*

@Database(
    entities = [
        AssetEntity::class,
        AssetFtsEntity::class,
        TyreEntity::class,
        DraftEntity::class,
        SyncOperationEntity::class
    ],
    version = 2,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class TyrePulseDatabase : RoomDatabase() {
    abstract fun assetDao(): AssetDao
    abstract fun tyreDao(): TyreDao
    abstract fun draftDao(): DraftDao
    abstract fun syncDao(): SyncDao
}
