package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Notification
import com.example.tyre_pulse_app.core.network.api.NotificationApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NotificationRepository @Inject constructor(
    private val notificationApi: NotificationApi
) {
    fun getNotifications(isRead: Boolean? = null): Flow<List<Notification>> = flow {
        val notifications = notificationApi.getNotifications(isRead = isRead)
        emit(notifications)
    }

    suspend fun markAsRead(id: String) {
        notificationApi.markAsRead(id)
    }

    suspend fun markAllAsRead() {
        notificationApi.markAllAsRead()
    }

    suspend fun registerFcmToken(token: String) {
        notificationApi.registerFcmToken(token)
    }
}
