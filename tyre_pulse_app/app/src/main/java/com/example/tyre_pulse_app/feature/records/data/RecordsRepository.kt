package com.example.tyre_pulse_app.feature.records.data

import com.example.tyre_pulse_app.core.network.api.RecordsApi
import com.example.tyre_pulse_app.feature.records.model.TyreRecord
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RecordsRepository @Inject constructor(
    private val recordsApi: RecordsApi
) {
    suspend fun getTyreRecords(
        page: Int = 0,
        pageSize: Int = 30,
        site: String? = null,
        risk: String? = null,
        searchQuery: String? = null
    ): List<TyreRecord> {
        // Build the or filter for search
        val orFilter = if (!searchQuery.isNullOrBlank()) {
            "asset_no.ilike.%$searchQuery%,serial_no.ilike.%$searchQuery%,brand.ilike.%$searchQuery%"
        } else null

        return recordsApi.getTyreRecords(
            limit = pageSize,
            offset = page * pageSize,
            siteEq = if (site.isNullOrBlank()) null else "eq.$site",
            riskEq = if (risk.isNullOrBlank()) null else "eq.$risk",
            orFilter = orFilter
        )
    }
}
