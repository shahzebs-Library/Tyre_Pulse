package com.example.tyre_pulse_app.feature.approvals.ui

import androidx.lifecycle.SavedStateHandle
import app.cash.turbine.test
import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.model.ApprovalStatus
import com.example.tyre_pulse_app.core.data.repository.ApprovalRepository
import com.example.tyre_pulse_app.core.testing.rules.MainDispatcherRule
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

@ExperimentalCoroutinesApi
class ApprovalsViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val repository = mockk<ApprovalRepository>(relaxed = true)

    @Test
    fun `initial state uses saved state handle values`() = runTest {
        val savedStateHandle = SavedStateHandle(
            mapOf(
                "status" to ApprovalStatus.APPROVED,
                "query" to "test query",
                "category" to "Maintenance"
            )
        )
        
        every { repository.getApprovals(any(), any(), any(), any(), any()) } returns flowOf(emptyList())

        val viewModel = ApprovalsViewModel(repository, savedStateHandle)

        viewModel.uiState.test {
            // First item might be default if init runs fast, but we expect it to eventually match saved state
            val state = awaitItem() 
            // In our implementation, the init block triggers a load based on combined flow.
            // Depending on timing, we might need to skip or wait for the correct state.
            // Given the combined flow and savedStateHandle.getMutableStateFlow, 
            // the UI state should eventually reflect the saved values.
            
            assertEquals(ApprovalStatus.APPROVED, state.selectedStatus)
            assertEquals("test query", state.searchQuery)
            assertEquals("Maintenance", state.selectedCategory)
        }
    }

    @Test
    fun `changing filters updates ui state and triggers repository load`() = runTest {
        val viewModel = ApprovalsViewModel(repository, SavedStateHandle())
        
        viewModel.onStatusSelected(ApprovalStatus.REJECTED)
        viewModel.onSearchQueryChanged("new search")

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals(ApprovalStatus.REJECTED, state.selectedStatus)
            assertEquals("new search", state.searchQuery)
        }
    }
}
