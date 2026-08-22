package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.WashRecord
import com.example.tyre_pulse_app.core.network.api.WashApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WashRepository @Inject constructor(
    private val washApi: WashApi
) {
    fun getWashRecords(site: String? = null, assetNo: String? = null): Flow<List<WashRecord>> = flow {
        val records = washApi.getWashRecords(site = site, assetNo = assetNo)
        emit(records)
    }

    suspend fun logWash(record: WashRecord): WashRecord {
        return washApi.logWash(record)
    }
}
