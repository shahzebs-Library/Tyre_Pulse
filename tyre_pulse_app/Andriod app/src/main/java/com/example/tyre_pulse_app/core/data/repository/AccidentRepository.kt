package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Accident
import com.example.tyre_pulse_app.core.model.AccidentStatus
import com.example.tyre_pulse_app.core.model.Claim
import com.example.tyre_pulse_app.core.network.api.AccidentApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AccidentRepository @Inject constructor(
    private val accidentApi: AccidentApi
) {
    fun getAccidents(status: AccidentStatus? = null, assetId: String? = null): Flow<List<Accident>> = flow {
        val accidents = accidentApi.getAccidents(status = status?.name, assetId = assetId)
        emit(accidents)
    }

    suspend fun getAccident(id: String): Accident {
        return accidentApi.getAccident(id)
    }

    suspend fun reportAccident(accident: Accident): Accident {
        return accidentApi.reportAccident(accident)
    }

    suspend fun fileClaim(accidentId: String, claim: Claim): Claim {
        return accidentApi.fileClaim(accidentId, claim)
    }
}
