package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Notification
import com.example.tyre_pulse_app.core.network.Pg
import com.example.tyre_pulse_app.core.network.api.NotificationApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NotificationRepository @Inject constructor(
    private val notificationApi: NotificationApi
) {
    fun getNotifications(isRead: Boolean? = null, page: Int = 0, pageSize: Int = 20): Flow<List<Notification>> = flow {
        val notifications = notificationApi.getNotifications(
            read = Pg.eq(isRead?.toString()),
            limit = pageSize,
            offset = page * pageSize
        )
        emit(notifications)
    }

    suspend fun markAsRead(id: String) {
        val patch = buildJsonObject { put("read", JsonPrimitive(true)) }
        notificationApi.markAsRead(id = Pg.eq(id) ?: "eq.$id", patch = patch)
    }

    suspend fun markAllAsRead() {
        // RLS scopes notifications to the caller's own rows, so this only
        // ever touches the signed-in user's unread notifications.
        val patch = buildJsonObject { put("read", JsonPrimitive(true)) }
        notificationApi.markAllAsRead(read = "eq.false", patch = patch)
    }

    /** [userId] must be the CURRENT session's own id - profiles UPDATE is RLS-scoped to auth.uid(). */
    suspend fun registerPushToken(userId: String, token: String) {
        val patch = buildJsonObject { put("push_token", JsonPrimitive(token)) }
        notificationApi.registerPushToken(userId = Pg.eq(userId) ?: "eq.$userId", patch = patch)
    }
}
