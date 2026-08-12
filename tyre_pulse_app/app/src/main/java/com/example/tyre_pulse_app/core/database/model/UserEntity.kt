package com.example.tyre_pulse_app.core.database.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "users")
data class UserEntity(
    @PrimaryKey val id: String,
    val tenantId: String,
    val name: String,
    val email: String,
    val avatarUrl: String? = null
)
