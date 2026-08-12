package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.database.dao.TyreDao
import com.example.tyre_pulse_app.core.model.Tyre
import com.example.tyre_pulse_app.core.model.TyreStatus
import com.example.tyre_pulse_app.core.network.api.TyreApi
import com.example.tyre_pulse_app.core.network.api.TyreReplacementApi
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class TyreRepositoryTest {

    private val tyreApi = mockk<TyreApi>()
    private val tyreReplacementApi = mockk<TyreReplacementApi>()
    private val tyreDao = mockk<TyreDao>(relaxed = true)
    private val json = Json { ignoreUnknownKeys = true }

    private val repository = TyreRepository(tyreApi, tyreReplacementApi, tyreDao, json)

    @Test
    fun `getTyre fetches from API if not in database`() = runTest {
        val tyreId = "tyre-123"
        val mockTyre = Tyre(
            id = tyreId,
            serialNumber = "S123",
            brand = "Michelin",
            pattern = "X-Line",
            size = "315/80R22.5",
            status = TyreStatus.AVAILABLE,
            tenantId = "t1",
            companyId = "c1",
            countryId = "sa"
        )

        coEvery { tyreDao.getTyreById(tyreId) } returns null
        coEvery { tyreApi.getTyre(tyreId) } returns mockTyre

        val result = repository.getTyre(tyreId)

        assertEquals(mockTyre, result)
        coVerify { tyreDao.insertTyres(any()) }
    }
}
