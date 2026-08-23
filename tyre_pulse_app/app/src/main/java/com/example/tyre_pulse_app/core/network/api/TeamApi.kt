package com.example.tyre_pulse_app.core.network.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Query

/**
 * The people on the team, from public.profiles.
 *
 * Row visibility is bounded server-side by that table's own policies; this app does
 * not add a client-side filter and must not pretend to.
 */
@Serializable
data class TeamMemberDto(
    val id: String? = null,
    @SerialName("full_name") val fullName: String? = null,
    val username: String? = null,
    val role: String? = null,
    val site: String? = null,
) {
    companion object {
        const val SELECT = "id,full_name,username,role,site"
    }
}

interface TeamApi {
    @GET("profiles")
    suspend fun getTeam(
        @Query("select") select: String = TeamMemberDto.SELECT,
        @Query("order") order: String = "full_name.asc.nullslast",
        @Query("limit") limit: Int = 200,
    ): List<TeamMemberDto>
}
