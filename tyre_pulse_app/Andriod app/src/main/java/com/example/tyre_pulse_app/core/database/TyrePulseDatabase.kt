package com.example.tyre_pulse_app.core.database

import androidx.room.Database
import androidx.room.RoomDatabase
import com.example.tyre_pulse_app.core.database.dao.AssetDao
import com.example.tyre_pulse_app.core.database.dao.InspectionDraftDao
import com.example.tyre_pulse_app.core.database.dao.SyncDao
import com.example.tyre_pulse_app.core.database.dao.TyreDao
import com.example.tyre_pulse_app.core.database.dao.UserDao
import com.example.tyre_pulse_app.core.database.model.AssetEntity
import com.example.tyre_pulse_app.core.database.model.InspectionDraftEntity
import com.example.tyre_pulse_app.core.database.model.SyncOperationEntity
import com.example.tyre_pulse_app.core.database.model.TyreEntity
import com.example.tyre_pulse_app.core.database.model.UserEntity

import com.example.tyre_pulse_app.core.database.model.AssetFtsEntity

@Database(
    entities = [
        UserEntity::class, 
        AssetEntity::class,
        AssetFtsEntity::class, // Agent A2: Search Speed
        InspectionDraftEntity::class, 
        TyreEntity::class,
        SyncOperationEntity::class
    ], 
    version = 5
)
abstract class TyrePulseDatabase : RoomDatabase() {
    abstract fun userDao(): UserDao
    abstract fun assetDao(): AssetDao
    abstract fun inspectionDraftDao(): InspectionDraftDao
    abstract fun tyreDao(): TyreDao
    abstract fun syncDao(): SyncDao
}
