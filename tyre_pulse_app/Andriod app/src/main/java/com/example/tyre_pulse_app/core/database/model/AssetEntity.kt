package com.example.tyre_pulse_app.core.database.model

import androidx.room.Entity
import androidx.room.PrimaryKey

import androidx.room.Fts4

@Fts4
@Entity(tableName = "assets_fts")
data class AssetFtsEntity(
    val assetNumber: String,
    val plateNumber: String?
)

@Entity(tableName = "assets")
data class AssetEntity(
    @PrimaryKey val id: String,
    val assetNumber: String,
    val plateNumber: String?,
    val category: String,
    val type: String,
    val status: String,
    val currentKm: Long?,
    val hourMeter: Long?,
    val tenantId: String,
    val companyId: String,
    val countryId: String,
    val siteId: String?,
    val latestInspectionDate: String?,
    val latestInspectionStatus: String?,
    val rawData: String // JSON serialized Asset object for easy retrieval of complex fields
)
