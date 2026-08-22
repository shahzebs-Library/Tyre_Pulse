package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.WorkOrder
import com.example.tyre_pulse_app.core.model.WorkshopEvent
import retrofit2.http.*

interface WorkshopApi {
    @GET("workshop_events")
    suspend fun getWorkshopEvents(
        @Query("user_id") userId: String? = null
    ): List<WorkshopEvent>
    @GET("workshop/jobs")
    suspend fun getWorkOrders(
        @Query("status") status: String? = null,
        @Query("technicianId") technicianId: String? = null,
        @Query("assetId") assetId: String? = null,
        @Query("page") page: Int = 0,
        @Query("pageSize") pageSize: Int = 20
    ): List<WorkOrder>

    @GET("workshop/jobs/{id}")
    suspend fun getWorkOrder(@Path("id") id: String): WorkOrder

    @PATCH("workshop/jobs/{id}/status")
    suspend fun updateWorkOrderStatus(
        @Path("id") id: String,
        @Body status: String
    ): WorkOrder

    @POST("workshop/jobs/{id}/start")
    suspend fun startJob(@Path("id") id: String): WorkOrder

    @POST("workshop/jobs/{id}/complete")
    suspend fun completeJob(@Path("id") id: String, @Body details: String): WorkOrder
}
