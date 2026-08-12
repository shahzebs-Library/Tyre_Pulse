package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Notification
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.PATCH
import retrofit2.http.Query

interface NotificationApi {
    @GET("notifications")
    suspend fun getNotifications(
        @Query("read") read: String? = null,
        @Query("limit") limit: Int = 20,
        @Query("offset") offset: Int = 0,
        @Query("order") order: String = "created_at.desc",
        @Query("select") select: String = "*"
    ): List<Notification>

    @Headers("Prefer: return=minimal")
    @PATCH("notifications")
    suspend fun markAsRead(
        @Query("id") id: String,
        @Body patch: JsonObject
    )

    /** RLS scopes every notifications row to its own user, so no explicit user_id filter is needed. */
    @Headers("Prefer: return=minimal")
    @PATCH("notifications")
    suspend fun markAllAsRead(
        @Query("read") read: String,
        @Body patch: JsonObject
    )

    /**
     * The push token lives on `profiles.push_token`, not a "register-token"
     * action endpoint - registering is a PATCH of the caller's own profile row.
     */
    @Headers("Prefer: return=minimal")
    @PATCH("profiles")
    suspend fun registerPushToken(
        @Query("id") userId: String,
        @Body patch: JsonObject
    )
}
