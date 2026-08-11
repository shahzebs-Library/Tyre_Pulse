package com.example.tyre_pulse_app.core.database.di

import android.content.Context
import androidx.room.Room
import com.example.tyre_pulse_app.core.database.TyrePulseDatabase
import com.example.tyre_pulse_app.core.database.dao.AssetDao
import com.example.tyre_pulse_app.core.database.dao.InspectionDraftDao
import com.example.tyre_pulse_app.core.database.dao.SyncDao
import com.example.tyre_pulse_app.core.database.dao.TyreDao
import com.example.tyre_pulse_app.core.database.dao.UserDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

import com.example.tyre_pulse_app.core.database.SecuritySupport

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): TyrePulseDatabase =
        Room.databaseBuilder(
            context,
            TyrePulseDatabase::class.java,
            "tyre_pulse_db"
        )
        .openHelperFactory(SecuritySupport.getEncryptionFactory(context)) // Agent A1: Military-grade Encryption
        .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING) // High-performance scale
        .fallbackToDestructiveMigration()
        .build()

    @Provides
    fun provideUserDao(db: TyrePulseDatabase): UserDao = db.userDao()

    @Provides
    fun provideAssetDao(db: TyrePulseDatabase): AssetDao = db.assetDao()

    @Provides
    fun provideInspectionDraftDao(db: TyrePulseDatabase): InspectionDraftDao = db.inspectionDraftDao()

    @Provides
    fun provideTyreDao(db: TyrePulseDatabase): TyreDao = db.tyreDao()

    @Provides
    fun provideSyncDao(db: TyrePulseDatabase): SyncDao = db.syncDao()
}
