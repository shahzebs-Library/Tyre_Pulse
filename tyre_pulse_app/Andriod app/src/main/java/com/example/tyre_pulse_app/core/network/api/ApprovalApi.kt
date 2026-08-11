package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Approval
import retrofit2.http.GET
import retrofit2.http.Query

interface ApprovalApi {
    @GET("approvals")
    suspend fun getApprovals(
        @Query("status") status: String? = null,
        @Query("category") category: String? = null,
        @Query("title") query: String? = null,
        @Query("select") select: String = "*"
    ): List<Approval>

    @GET("approvals")
    suspend fun getApproval(
        @Query("id") id: String,
        @Query("select") select: String = "*"
    ): List<Approval>
}
