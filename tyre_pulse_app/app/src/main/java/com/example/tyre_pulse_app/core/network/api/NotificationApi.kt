package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Notification
import com.example.tyre_pulse_app.core.model.NotificationType
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import retrofit2.http.*

/**
 * Notifications, against PostgREST.
 *
 * The Retrofit base URL already ends in `/rest/v1/`, so paths are bare table names
 * and filters are query parameters. `notifications/{id}/read`,
 * `notifications/read-all` and `notifications/register-token` were nested resource
 * routes that this backend does not serve - all three 404'd.
 *
 * Row visibility and writes are bounded server-side by RLS:
 * `notifications_select_own` and `notifications_update_own` both restrict to
 * `user_id = auth.uid()`, so none of these calls needs - or can be trusted to
 * enforce - a client-side user filter.
 */
interface NotificationApi {

    /**
     * @param read a PostgREST filter, e.g. "is.true" or "not.is.true". Null reads
     *        both read and unread.
     */
    @GET("notifications")
    suspend fun getNotifications(
        @Query("select") select: String = NotificationDto.SELECT,
        @Query("read") read: String? = null,
        @Query("order") order: String = "created_at.desc.nullslast,id.desc",
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
    ): List<NotificationDto>

    /**
     * Mark one notification read.
     *
     * The body is a [JsonObject] so it carries exactly one key. A DTO would emit
     * every other column as an explicit null under the shared Json settings, which
     * would erase the row's title and body rather than leaving them alone.
     *
     * @param id a PostgREST filter, e.g. "eq.<uuid>".
     */
    @PATCH("notifications")
    suspend fun markAsRead(
        @Query("id") id: String,
        @Body patch: JsonObject,
        @Header("Prefer") prefer: String = "return=minimal",
    )

    /**
     * Mark every still-unread notification read.
     *
     * The filter is REQUIRED, and not only as a safeguard against an unfiltered
     * PATCH: `read` is a nullable column, so "unread" is `false` OR `null`, which
     * is `not.is.true` - filtering on `eq.false` alone would leave every
     * null-flagged notification unread while reporting success.
     *
     * Scope is the caller's own rows, enforced by RLS, not by anything here.
     */
    @PATCH("notifications")
    suspend fun markAllAsRead(
        @Body patch: JsonObject,
        @Query("read") read: String = "not.is.true",
        @Header("Prefer") prefer: String = "return=minimal",
    )

    /**
     * Register this device's push token.
     *
     * This is an RPC, not a table write: `POST /rest/v1/rpc/register_user_device`.
     * It mirrors what the Expo app does in `mobile/lib/notifications.ts`, which
     * calls the same function - verified against pg_proc:
     * `register_user_device(p_push_token text, p_platform text DEFAULT NULL,
     * p_device_id text DEFAULT NULL, p_app_version text DEFAULT NULL)`.
     *
     * Going through the RPC rather than inserting into `user_devices` directly is
     * what keeps multi-device registration correct: the function upserts on the
     * token so a second device does not overwrite the first, and it also stamps the
     * legacy `profiles.push_token` column that the server-side push consumers still
     * read.
     */
    @POST("rpc/register_user_device")
    suspend fun registerFcmToken(@Body args: JsonObject)
}

/**
 * A row of public.notifications exactly as PostgREST returns it.
 *
 * WHY THIS IS NOT THE DOMAIN MODEL. `getNotifications` used to deserialise
 * straight into [Notification], and could not have succeeded on a single row. The
 * domain model requires `message`, `category`, `tenantId`, `companyId` and
 * `countryId` with no defaults; the table has none of those columns - it has
 * `body`, and no tenancy columns at all, because its only scoping is `user_id`.
 * A key that is absent from the JSON on a field with no default is a
 * MissingFieldException, so the Notification Center threw on every load.
 *
 * Verified against information_schema on 2026-08-23. The full column list is:
 * id, user_id, type, title, body, entity_type, entity_id, read, created_at.
 *
 * NOTE ON PLACEMENT: this belongs in `core/network/dto/` beside WorkOrderDto and
 * WorkshopEventDto. It is here because the change that introduced it was scoped to
 * a fixed file list that allowed exactly one new DTO file. Move it when that
 * constraint lifts; nothing depends on its location.
 */
@Serializable
data class NotificationDto(
    val id: String? = null,
    @SerialName("user_id") val userId: String? = null,
    val type: String? = null,
    val title: String? = null,
    val body: String? = null,
    @SerialName("entity_type") val entityType: String? = null,
    @SerialName("entity_id") val entityId: String? = null,
    val read: Boolean? = null,
    @SerialName("created_at") val createdAt: String? = null,
) {
    companion object {
        const val SELECT = "id,user_id,type,title,body,entity_type,entity_id,read,created_at"
    }
}

/**
 * Fold the stored `type` token onto the domain severity enum.
 *
 * The column is free text and holds a DOMAIN token, not a severity. Measured on
 * the live table: approval 1,567 / approval_decision 390 / accident 232 /
 * upload_gap 149 / escalation 64 / broadcast 37 / success 15 / info 15 /
 * warning 4 / closure_request 4.
 *
 * `approval_decision` folds to INFO rather than SUCCESS on purpose: a decision may
 * be an approval or a rejection, and the token alone does not say which. Calling
 * every decision a success would put a green tick on a rejection.
 *
 * Anything unrecognised becomes INFO, the least assertive band - an unknown token
 * must not be dressed up as an emergency, nor hidden as though it were routine.
 */
fun notificationTypeOf(raw: String?): NotificationType =
    when (raw?.trim()?.lowercase()) {
        "approval", "closure_request" -> NotificationType.ACTION_REQUIRED
        "error", "failure", "failed" -> NotificationType.ERROR
        "escalation", "accident", "warning", "upload_gap" -> NotificationType.WARNING
        "success" -> NotificationType.SUCCESS
        else -> NotificationType.INFO
    }

/**
 * Map a row to the domain model.
 *
 * `category` takes the RAW `type` token. That is not a substitution - the domain
 * model's own comment describes category as "APPROVAL", "TASK", "INSPECTION", and
 * this column is exactly that vocabulary; the enum above is a separate, lossy
 * severity read of the same value.
 *
 * `tenantId`, `companyId`, `countryId` and `siteId` have NO columns on this table.
 * They are left empty rather than filled from the signed-in user's workspace: a
 * notification carries no tenancy of its own, and copying the reader's workspace
 * onto it would make a borrowed value look like a recorded one.
 */
fun NotificationDto.toDomain(): Notification = Notification(
    id = id.orEmpty(),
    title = title.orEmpty(),
    message = body.orEmpty(),
    type = notificationTypeOf(type),
    category = type.orEmpty(),
    relatedEntityType = entityType,
    relatedEntityId = entityId,
    isRead = read == true,
    createdAt = createdAt.orEmpty(),
    tenantId = "",
    companyId = "",
    countryId = "",
    siteId = null,
)
