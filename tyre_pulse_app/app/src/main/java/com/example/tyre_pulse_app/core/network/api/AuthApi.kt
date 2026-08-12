package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.network.model.request.LoginRequest
import com.example.tyre_pulse_app.core.network.model.response.LoginResponse
import com.example.tyre_pulse_app.core.model.Profile
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

@Serializable
data class IdentifierRequest(val identifier: String)

interface AuthApi {
    @POST("auth/v1/token?grant_type=password")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @POST("rest/v1/rpc/get_email_by_identifier")
    suspend fun resolveEmail(@Body request: IdentifierRequest): String?

    @GET("rest/v1/profiles")
    suspend fun getProfile(
        @Query("id") id: String,
        @Query("select") select: String = "*"
    ): List<Profile>
}
