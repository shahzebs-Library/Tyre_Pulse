package com.example.tyre_pulse_app.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A row of public.stock_records as PostgREST returns it.
 *
 * Column names taken from the live schema, not guessed: site, description,
 * stock_qty, min_level, critical_level, stock_status, reorder_qty,
 * management_action, region, country.
 */
@Serializable
data class StockRecordDto(
    val id: String? = null,
    val site: String? = null,
    val description: String? = null,
    @SerialName("stock_qty") val stockQty: Int? = null,
    @SerialName("min_level") val minLevel: Int? = null,
    @SerialName("critical_level") val criticalLevel: Int? = null,
    @SerialName("stock_status") val stockStatus: String? = null,
    @SerialName("reorder_qty") val reorderQty: Int? = null,
    val region: String? = null,
    val country: String? = null,
) {
    companion object {
        /**
         * PostgREST returns only the columns asked for, so this list and the fields
         * above are a PAIR - a field with no column here silently arrives null.
         */
        const val SELECT = "id,site,description,stock_qty,min_level,critical_level," +
            "stock_status,reorder_qty,region,country"
    }
}
