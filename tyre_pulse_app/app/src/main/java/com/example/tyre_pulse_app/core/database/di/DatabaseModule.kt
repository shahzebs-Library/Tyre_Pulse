package com.example.tyre_pulse_app.core.database.di

import android.content.Context
import androidx.room.Room
import androidx.room.RoomDatabase
import com.example.tyre_pulse_app.core.database.TyrePulseDatabase
import com.example.tyre_pulse_app.core.database.dao.*
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
        .openHelperFactory(SecuritySupport.getEncryptionFactory(context))
        .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
        .fallbackToDestructiveMigration()
        .build()

    @Provides
    fun provideAssetDao(db: TyrePulseDatabase): AssetDao = db.assetDao()

    @Provides
    fun provideTyreDao(db: TyrePulseDatabase): TyreDao = db.tyreDao()

    @Provides
    fun provideSyncDao(db: TyrePulseDatabase): SyncDao = db.syncDao()

    @Provides
    fun provideDraftDao(db: TyrePulseDatabase): DraftDao = db.draftDao()
}
