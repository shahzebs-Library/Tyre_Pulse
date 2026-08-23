package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.network.dto.PmProgramDto
import com.example.tyre_pulse_app.core.network.dto.RecordServiceRequest
import kotlinx.serialization.json.JsonElement
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * Preventive maintenance, from public.pm_programs.
 *
 * The native app had no PM module at all, though the Expo app has carried one for
 * managers and directors.
 */
interface MaintenanceApi {

    /**
     * Active programmes, soonest due first.
     *
     * `nullslast` matters: a programme with no next_due is not "due now", and sorting
     * nulls first would put every undated plan above genuinely overdue work.
     */
    @GET("pm_programs")
    suspend fun getPrograms(
        @Query("select") select: String = PmProgramDto.SELECT,
        @Query("status") statusEq: String = "eq.active",
        @Query("site") siteEq: String? = null,
        @Query("order") order: String = "next_due.asc.nullslast",
        @Query("limit") limit: Int = 200,
    ): List<PmProgramDto>

    /**
     * Record a completed service.
     *
     * This is a SECURITY DEFINER RPC, not a table write, and that is deliberate: it
     * inserts the service record AND advances the programme's next_due in one
     * transaction. Writing pm_service_records directly would log the work and leave
     * the schedule saying it is still due.
     */
    @POST("rpc/record_pm_service")
    suspend fun recordService(@Body request: RecordServiceRequest): JsonElement
}
