package com.example.tyre_pulse_app.core.database.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "tyres")
data class TyreEntity(
    @PrimaryKey val id: String,
    val serialNumber: String,
    val brand: String,
    val pattern: String,
    val size: String,
    val status: String,
    val tenantId: String,
    val companyId: String,
    val countryId: String,
    val siteId: String?,
    val rawData: String // JSON serialized Tyre object
)
