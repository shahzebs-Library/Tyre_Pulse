package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.model.ApprovalStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

import com.example.tyre_pulse_app.core.network.api.ApprovalApi
import kotlinx.coroutines.flow.emitAll

@Singleton
class ApprovalRepository @Inject constructor(
    private val approvalApi: ApprovalApi
) {
    fun getApprovals(
        status: ApprovalStatus,
        query: String = "",
        category: String? = null,
        page: Int = 0,
        pageSize: Int = 20
    ): Flow<List<Approval>> = flow {
        val remote = try {
            approvalApi.getApprovals(
                status = status.name,
                category = category,
                query = if (query.isEmpty()) null else "ilike.*$query*"
            )
        } catch (e: Exception) {
            emptyList()
        }
        
        if (remote.isEmpty()) {
            // Mock data for demo purposes if backend is empty
            emit(listOf(
                Approval(
                    id = "mock-1",
                    title = "Replace 4 Tyres on TRK-09",
                    requester = "Ahmed S.",
                    status = status,
                    date = "2023-10-24",
                    category = "Maintenance"
                ),
                Approval(
                    id = "mock-2",
                    title = "Purchase Order: 50x Michelin X Multi",
                    requester = "Sarah M.",
                    status = status,
                    date = "2023-10-23",
                    category = "Purchase"
                )
            ))
        } else {
            emit(remote)
        }
    }

    fun getApprovalById(id: String): Flow<Approval?> = flow {
        val remote = approvalApi.getApproval(id)
        emit(remote.firstOrNull())
    }
}
