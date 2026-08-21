package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.feature.records.model.TyreRecord
import retrofit2.http.GET
import retrofit2.http.Query

interface RecordsApi {
    @GET("tyre_records")
    suspend fun getTyreRecords(
        @Query("select") select: String = "*",
        @Query("limit") limit: Int = 30,
        @Query("offset") offset: Int = 0,
        @Query("order") order: String = "issue_date.desc.nullslast",
        @Query("site") siteEq: String? = null,
        @Query("risk_level") riskEq: String? = null,
        @Query("or") orFilter: String? = null
    ): List<TyreRecord>
}
