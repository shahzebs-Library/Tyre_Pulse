package com.example.tyre_pulse_app.feature.tyre_replacement.ui

import androidx.lifecycle.SavedStateHandle
import app.cash.turbine.test
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
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
class TyreReplacementViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val tyreRepository = mockk<TyreRepository>(relaxed = true)
    private val assetRepository = mockk<AssetRepository>(relaxed = true)
    private val workspaceManager = mockk<WorkspaceManager>()

    @Test
    fun `initial state loads tyre and asset data`() = runTest {
        val tyreId = "tyre-1"
        val assetId = "asset-1"
        val tyre = Tyre(
            id = tyreId,
            serialNumber = "S123",
            brand = "Michelin",
            pattern = "X-Line",
            size = "315/80R22.5",
            status = TyreStatus.FITTED,
            currentAssetId = assetId,
            tenantId = "t1",
            companyId = "c1",
            countryId = "sa"
        )
        val asset = Asset(
            id = assetId,
            assetNumber = "A100",
            category = "Truck",
            type = "6x4",
            status = AssetStatus.ACTIVE,
            tenantId = "t1",
            companyId = "c1",
            countryId = "sa"
        )

        coEvery { tyreRepository.getTyre(tyreId) } returns tyre
        coEvery { assetRepository.getAsset(assetId) } returns asset
        coEvery { tyreRepository.getRemovalReasons() } returns emptyList()

        val savedStateHandle = SavedStateHandle(mapOf("tyreId" to tyreId))
        val viewModel = TyreReplacementViewModel(tyreRepository, assetRepository, workspaceManager, savedStateHandle)

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals(tyre, state.removedTyre)
            assertEquals(asset, state.asset)
            assertEquals(false, state.isLoading)
        }
    }
}
