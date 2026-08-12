package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Profile(
    val id: String,
    @SerialName("full_name") val fullName: String? = null,
    val username: String? = null,
    val role: String? = null,
    val email: String? = null,
    @SerialName("employee_id") val employeeId: String? = null,
    val site: String? = null,
    val country: String? = null,
    val approved: Boolean = false,
    val locked: Boolean = false,
    @SerialName("is_super_admin") val isSuperAdmin: Boolean = false,
    @SerialName("organisation_id") val orgId: String? = null
)
