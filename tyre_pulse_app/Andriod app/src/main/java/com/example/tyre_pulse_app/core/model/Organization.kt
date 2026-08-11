package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class Tenant(
    val id: String,
    val name: String,
    val logoUrl: String? = null
)

@Serializable
data class Company(
    val id: String,
    val tenantId: String,
    val name: String,
    val registrationNumber: String? = null
)

@Serializable
data class Country(
    val id: String,
    val companyId: String,
    val name: String,
    val code: String, // ISO code
    val currency: String,
    val timezone: String,
    val dateFormat: String = "dd/MM/yyyy",
    val units: String = "Metric"
)

@Serializable
data class Site(
    val id: String,
    val countryId: String,
    val name: String,
    val location: String? = null
)

@Serializable
data class WorkspaceContext(
    val tenant: Tenant,
    val company: Company,
    val country: Country,
    val site: Site? = null
)
