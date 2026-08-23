package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Notification
import com.example.tyre_pulse_app.core.network.api.NotificationApi
import com.example.tyre_pulse_app.core.network.api.NotificationDto
import com.example.tyre_pulse_app.core.network.api.toDomain
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Notifications, read from and written to public.notifications.
 *
 * WHAT THIS REPLACED. `markAsRead`, `markAllAsRead` and `registerFcmToken` posted
 * to `notifications/{id}/read`, `notifications/read-all` and
 * `notifications/register-token`. None of those is a PostgREST path, so tapping a
 * notification never marked it read. The read itself was broken too, for a
 * different reason - see NotificationDto.
 *
 * Every call lets a failure PROPAGATE. "Nothing to read" and "we could not check"
 * are opposite statements, and only one of them should ever be shown as an empty
 * inbox.
 */
@Singleton
class NotificationRepository @Inject constructor(
    private val notificationApi: NotificationApi
) {

    /**
     * @param isRead null for everything, true for read only, false for unread.
     *        "Unread" is `not.is.true`, not `eq.false`: the column is nullable and
     *        a null flag is unread.
     */
    fun getNotifications(isRead: Boolean? = null, limit: Int = PAGE_SIZE): Flow<List<Notification>> = flow {
        emit(
            notificationApi.getNotifications(
                read = when (isRead) {
                    null -> null
                    true -> "is.true"
                    false -> "not.is.true"
                },
                limit = limit,
            ).map(NotificationDto::toDomain)
        )
    }

    suspend fun markAsRead(id: String) {
        notificationApi.markAsRead(id = "eq.$id", patch = READ_TRUE)
    }

    /**
     * Marks every unread notification read. Scope is the caller's own rows,
     * enforced by the `notifications_update_own` RLS policy - there is no
     * client-side user filter to forget.
     */
    suspend fun markAllAsRead() {
        notificationApi.markAllAsRead(patch = READ_TRUE)
    }

    /**
     * Register this device's push token through the `register_user_device` RPC -
     * the same function the Expo app calls, so the two apps share one device
     * registry instead of each keeping its own idea of where a push should go.
     *
     * Only non-null arguments are sent. The RPC declares `p_platform`,
     * `p_device_id` and `p_app_version` as DEFAULT NULL, so omitting one is
     * exactly equivalent to passing null and keeps the body honest about what this
     * device actually knows about itself.
     */
    suspend fun registerFcmToken(
        token: String,
        platform: String? = ANDROID,
        deviceId: String? = null,
        appVersion: String? = null,
    ) {
        val args = buildMap<String, JsonElement> {
            put("p_push_token", JsonPrimitive(token))
            platform?.let { put("p_platform", JsonPrimitive(it)) }
            deviceId?.let { put("p_device_id", JsonPrimitive(it)) }
            appVersion?.let { put("p_app_version", JsonPrimitive(it)) }
        }
        notificationApi.registerFcmToken(JsonObject(args))
    }

    private companion object {
        const val PAGE_SIZE = 50
        const val ANDROID = "android"

        /**
         * A one-key body. Anything wider would be sent as explicit nulls under the
         * shared Json settings and would erase the row's other columns.
         */
        val READ_TRUE = JsonObject(mapOf("read" to JsonPrimitive(true)))
    }
}
