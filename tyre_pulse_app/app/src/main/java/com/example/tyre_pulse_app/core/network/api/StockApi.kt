package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.network.dto.StockRecordDto
import retrofit2.http.GET
import retrofit2.http.Query

/**
 * Stock on hand, from public.stock_records.
 *
 * There was no stock endpoint at all before this: the Stock screen's ViewModel held
 * four invented tyre lines as its default state.
 */
interface StockApi {
    @GET("stock_records")
    suspend fun getStockRecords(
        @Query("select") select: String = StockRecordDto.SELECT,
        @Query("site") siteEq: String? = null,
        @Query("order") order: String = "description.asc.nullslast",
        @Query("limit") limit: Int = 200,
    ): List<StockRecordDto>
}
