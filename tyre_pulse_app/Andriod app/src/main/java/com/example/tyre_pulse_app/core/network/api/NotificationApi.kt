package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Notification
import retrofit2.http.*

interface NotificationApi {
    @GET("notifications")
    suspend fun getNotifications(
        @Query("isRead") isRead: Boolean? = null,
        @Query("page") page: Int = 0,
        @Query("pageSize") pageSize: Int = 20
    ): List<Notification>

    @POST("notifications/{id}/read")
    suspend fun markAsRead(@Path("id") id: String)

    @POST("notifications/read-all")
    suspend fun markAllAsRead()

    @POST("notifications/register-token")
    suspend fun registerFcmToken(@Body token: String)
}
