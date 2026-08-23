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
    /**
     * `profiles.country` is `text[]` in Postgres, NOT a scalar - a user can be scoped
     * to several countries.
     *
     * IT WAS DECLARED `String?` HERE, AND THAT BROKE LOGIN FOR ALMOST EVERYONE.
     * `getProfile` selects `*`, so PostgREST returns `"country": ["KSA"]`. Deserialising
     * a JSON array into a String throws, and `coerceInputValues` does not rescue a type
     * mismatch - it only coerces null for a non-nullable field. The throw was caught by
     * the login try/catch and returned as a plain `Result.failure`, so sign-in simply
     * failed with no clue why. 41 of the 43 real profiles carry a non-empty country
     * array, so this was every user but two.
     */
    val country: List<String>? = null,
    val approved: Boolean = false,
    val locked: Boolean = false,
    @SerialName("is_super_admin") val isSuperAdmin: Boolean = false,
    @SerialName("organisation_id") val orgId: String? = null
)

/**
 * The one country to work in, from a scope that may name several.
 *
 * Mirrors the Expo app's normaliseCountry: a multi-country scope picks the first
 * entry, an empty scope yields null. Null means NOT KNOWN - callers must not
 * substitute a default country, because the country decides the CURRENCY, and
 * labelling AED figures "SAR" is how a report becomes wrong by a factor of ten.
 */
fun Profile.primaryCountry(): String? =
    country?.firstOrNull { it.isNotBlank() }?.trim()

/**
 * Currency for a country, matching the server's own country_currency table.
 * Returns null for a country we do not have a mapping for - an unknown country shows
 * an amount with no currency code rather than borrowing a neighbour's.
 */
fun currencyForCountry(country: String?): String? = when (country?.trim()?.uppercase()) {
    "KSA", "SA", "SAUDI ARABIA" -> "SAR"
    "UAE", "AE", "UNITED ARAB EMIRATES" -> "AED"
    "EGYPT", "EG" -> "EGP"
    else -> null
}
