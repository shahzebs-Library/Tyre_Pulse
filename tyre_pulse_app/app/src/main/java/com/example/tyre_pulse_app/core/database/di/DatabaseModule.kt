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

    /**
     * WARNING BEFORE YOU BUMP THE ROOM VERSION.
     *
     * `fallbackToDestructiveMigration()` below means a schema change with no
     * migration DROPS AND RECREATES this database. That is harmless for the cached
     * asset and tyre tables, which re-fetch - but `sync_queue` is the OFFLINE WRITE
     * QUEUE. It holds inspections, meter readings and fault reports that exist
     * NOWHERE ELSE until they sync. Bumping the version to add a column to any
     * entity would silently delete a technician's unsynced work on the next app
     * start, with no error anywhere.
     *
     * So: adding a column to sync_queue is not a free change. Either ship a real
     * Migration alongside it, or do without the column. SyncRepository's retry
     * backoff is derived from the drain cadence rather than a stored
     * `nextAttemptAt` column for exactly this reason.
     */
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
