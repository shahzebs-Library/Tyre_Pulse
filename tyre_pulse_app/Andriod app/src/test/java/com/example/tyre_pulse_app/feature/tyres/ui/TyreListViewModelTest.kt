package com.example.tyre_pulse_app.feature.tyres.ui

import androidx.lifecycle.SavedStateHandle
import app.cash.turbine.test
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.TyreRepository
import com.example.tyre_pulse_app.core.model.*
import com.example.tyre_pulse_app.core.testing.rules.MainDispatcherRule
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

@ExperimentalCoroutinesApi
class TyreListViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val repository = mockk<TyreRepository>(relaxed = true)
    private val workspaceManager = mockk<WorkspaceManager>()

    @Test
    fun `initial state loads tyres for current workspace`() = runTest {
        val tenantId = "tenant-1"
        val workspace = WorkspaceContext(
            tenant = Tenant(tenantId, "Tenant 1"),
            company = Company("comp-1", tenantId, "Company 1"),
            country = Country("sa", "comp-1", "Saudi Arabia", "SA", "SAR", "Asia/Riyadh")
        )
        
        every { workspaceManager.currentWorkspace } returns flowOf(workspace)
        coEvery { repository.searchTyres(tenantId, "") } returns flowOf(emptyList())

        val viewModel = TyreListViewModel(repository, workspaceManager, SavedStateHandle())

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals(false, state.isLoading)
            assertEquals(emptyList<Tyre>(), state.tyres)
        }
    }
}
