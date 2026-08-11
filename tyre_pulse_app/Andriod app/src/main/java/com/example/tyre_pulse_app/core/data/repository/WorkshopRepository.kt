package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.WorkOrder
import com.example.tyre_pulse_app.core.model.WorkOrderStatus
import com.example.tyre_pulse_app.core.network.api.WorkshopApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WorkshopRepository @Inject constructor(
    private val workshopApi: WorkshopApi
) {
    fun getWorkOrders(
        status: WorkOrderStatus? = null,
        technicianId: String? = null,
        assetId: String? = null
    ): Flow<List<WorkOrder>> = flow {
        val jobs = workshopApi.getWorkOrders(
            status = status?.name,
            technicianId = technicianId,
            assetId = assetId
        )
        emit(jobs)
    }

    suspend fun getWorkOrder(id: String): WorkOrder {
        return workshopApi.getWorkOrder(id)
    }

    suspend fun startJob(id: String): WorkOrder {
        return workshopApi.startJob(id)
    }

    suspend fun completeJob(id: String, details: String): WorkOrder {
        return workshopApi.completeJob(id, details)
    }
}
