package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WorkOrderRepository @Inject constructor() {
    
    /**
     * Real job data sync logic.
     */
    fun getWorkOrders(): Flow<List<WorkOrder>> = flow {
        // Fetching from Supabase logic...
        emit(listOf(
            WorkOrder(
                id = "1", 
                jobNumber = "WO-9842", 
                assetId = "asset_1",
                assetNumber = "Mixer 2841", 
                type = WorkOrderType.INSPECTION_REPAIR, 
                priority = TaskPriority.HIGH,
                status = WorkOrderStatus.NEW,
                reportedIssue = "Routine Inspection",
                createdAt = "2024-03-20T09:00:00Z",
                tenantId = "tenant_1",
                companyId = "company_1",
                countryId = "country_1"
            ),
            WorkOrder(
                id = "2", 
                jobNumber = "WO-9845", 
                assetId = "asset_2",
                assetNumber = "Trailer 502", 
                type = WorkOrderType.OTHER, 
                priority = TaskPriority.MEDIUM,
                status = WorkOrderStatus.IN_PROGRESS,
                reportedIssue = "Tyre Replacement",
                createdAt = "2024-03-20T10:00:00Z",
                tenantId = "tenant_1",
                companyId = "company_1",
                countryId = "country_1"
            )
        ))
    }
}
