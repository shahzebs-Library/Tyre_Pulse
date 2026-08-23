package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.network.dto.WorkOrderDto
import com.example.tyre_pulse_app.core.network.dto.WorkshopEventDto
import kotlinx.serialization.json.JsonObject
import retrofit2.http.*

/**
 * Workshop reads and writes, all against PostgREST.
 *
 * The Retrofit base URL already ends in `/rest/v1/`, so every path here is a bare
 * TABLE NAME and every filter is a query parameter. PostgREST has no nested
 * resource routes, which is why the previous shapes - `workshop/jobs`,
 * `workshop/jobs/{id}/status`, `workshop/jobs/{id}/start`,
 * `workshop/jobs/{id}/complete` and `workshop_events` - could never return
 * anything but a 404.
 *
 * FILTER CONVENTION. A PostgREST filter value carries its own operator, so callers
 * pass `"eq.<value>"`, not `"<value>"`. Passing a bare value silently matches
 * nothing.
 */
interface WorkshopApi {

    /**
     * Real PostgREST read of public.work_orders.
     *
     * This one was already correct and is the shape the rest of this interface now
     * copies: table at the root of /rest/v1/, filters as query parameters.
     */
    @GET("work_orders")
    suspend fun getWorkOrdersRows(
        @Query("select") select: String = WorkOrderDto.SELECT,
        @Query("status") status: String? = null,
        @Query("site") site: String? = null,
        @Query("order") order: String = "opened_at.desc.nullslast,id.desc",
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
    ): List<WorkOrderDto>

    /**
     * One work order by primary key.
     *
     * PostgREST answers a filtered table read with an ARRAY, even for a unique key,
     * so the return type is a list and the caller takes the first row. Declaring
     * this as a single object would fail to deserialise on every call.
     *
     * @param id a PostgREST filter, e.g. "eq.9f3c...".
     */
    @GET("work_orders")
    suspend fun getWorkOrderRow(
        @Query("id") id: String,
        @Query("select") select: String = WorkOrderDto.SELECT,
        @Query("limit") limit: Int = 1,
    ): List<WorkOrderDto>

    /**
     * Update columns on one work order.
     *
     * Replaces updateWorkOrderStatus / startJob / completeJob - all three were the
     * same operation (write some columns on one row) wearing three invented REST
     * routes. A single PATCH expresses it, and the caller decides which columns.
     *
     * The body is a [JsonObject] rather than a DTO ON PURPOSE. The shared Json is
     * configured with `encodeDefaults = true` and kotlinx emits explicit nulls by
     * default, so serialising a partly-filled DTO would send `"completed_at": null`
     * for every field the caller did not set - which does not mean "leave alone",
     * it means "erase". A JsonObject sends exactly the keys that were put in it.
     *
     * `Prefer: return=representation` makes PostgREST return the updated row, so
     * the caller renders what the database actually stored rather than what it
     * hoped it stored.
     *
     * @param id a PostgREST filter, e.g. "eq.9f3c...".
     */
    @PATCH("work_orders")
    suspend fun patchWorkOrder(
        @Query("id") id: String,
        @Body patch: JsonObject,
        @Query("select") select: String = WorkOrderDto.SELECT,
        @Header("Prefer") prefer: String = "return=representation",
    ): List<WorkOrderDto>

    /**
     * Technician activity events, from public.tech_activity_events.
     *
     * There is no `workshop_events` table; this is the real one. Row visibility is
     * already bounded server-side - `tech_activity_events_own_visibility` restricts
     * a non-elevated user to their own events - so the userId filter narrows a set
     * that RLS has already scoped, rather than being the security boundary.
     *
     * @param userId a PostgREST filter, e.g. "eq.<uuid>".
     */
    @GET("tech_activity_events")
    suspend fun getWorkshopEvents(
        @Query("select") select: String = WorkshopEventDto.SELECT,
        @Query("user_id") userId: String? = null,
        @Query("job_id") jobId: String? = null,
        @Query("order") order: String = "at.desc",
        @Query("limit") limit: Int = 200,
    ): List<WorkshopEventDto>

    /**
     * Record one technician activity event.
     *
     * Only `user_id` and `event_type` have to be supplied - `id`,
     * `organisation_id`, `at` and `foreman_confirmed` all carry column defaults,
     * and `organisation_id` defaults to `app_current_org()`, so the tenant is
     * stamped by the database rather than trusted from the client.
     *
     * The body is a [JsonObject] so absent fields stay absent and take those
     * defaults, instead of arriving as explicit nulls that override them.
     */
    @POST("tech_activity_events")
    suspend fun postWorkshopEvent(
        @Body event: JsonObject,
        @Query("select") select: String = WorkshopEventDto.SELECT,
        @Header("Prefer") prefer: String = "return=representation",
    ): List<WorkshopEventDto>
}
