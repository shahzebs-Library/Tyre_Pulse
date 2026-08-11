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
        val remote = approvalApi.getApprovals(
            status = status.name,
            category = category,
            query = if (query.isEmpty()) null else "ilike.*$query*"
        )
        emit(remote)
    }

    fun getApprovalById(id: String): Flow<Approval?> = flow {
        val remote = approvalApi.getApproval(id)
        emit(remote.firstOrNull())
    }
}
