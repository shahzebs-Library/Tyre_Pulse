package com.example.tyre_pulse_app.feature.assets.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.network.api.MaintenanceApi
import com.example.tyre_pulse_app.core.network.api.OdometerApi
import com.example.tyre_pulse_app.core.network.api.TyreApi
import com.example.tyre_pulse_app.core.network.dto.PmProgramDto
import com.example.tyre_pulse_app.core.network.dto.TyreHistoryDto
import com.example.tyre_pulse_app.feature.maintenance.ui.MaintenanceViewModel
import com.example.tyre_pulse_app.feature.maintenance.ui.PmPlan
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * One fitment episode of one tyre on THIS asset, read from public.tyre_records.
 *
 * There is no `condition` here, and that is deliberate rather than an omission:
 * `tyre_records.risk_level` is NULL on all 11,205 rows (measured live, 2026-08-23),
 * so a tyre's condition is genuinely UNMEASURED. Carrying a condition field would
 * invite a caller to colour a wheel green or red from a column that has never held
 * a value.
 */
data class AssetTyreRow(
    val id: String,
    val serial: String?,
    val position: String?,
    val brand: String?,
    val size: String?,
    val fittedOn: String?,
    val removedOn: String?,
    val kmAtFitment: Double?,
    val totalKm: Double?,
    val removalReason: String?,
) {
    /** A row with no removal date is still on the vehicle. */
    val isFitted: Boolean get() = removedOn.isNullOrBlank()
}

/**
 * WHAT THIS STATE REPLACED. It used to carry a `TelemetryData` block whose engine
 * temperature, oil pressure, fuel level, health score and "High Engine Temp
 * Detected" warning were produced by `Random.nextFloat()` on a 2.5 second loop and
 * rendered under the heading "Live Telemetry". There is no telemetry source in this
 * database - no readings table, no API - so every number under that heading was
 * invented, and the health score derived from it was invented twice over. It is
 * gone rather than reworded: an operator acting on a fabricated engine-temperature
 * alarm is the exact failure this screen existed to cause.
 *
 * Every remaining figure below comes from a table, and each read carries its own
 * error so that "nothing recorded" and "we could not look" never render the same.
 */
data class AssetDetailUiState(
    val asset: Asset? = null,
    val isLoading: Boolean = false,
    val error: String? = null,

    /** Newest reading from odometer_logs. Null means none has been recorded. */
    val latestOdometerKm: Double? = null,
    val latestOdometerDate: String? = null,

    val tyres: List<AssetTyreRow> = emptyList(),
    val tyresLoading: Boolean = false,
    val tyresError: String? = null,
    /** True when the read hit its row ceiling, so the list may not be the whole story. */
    val tyresTruncated: Boolean = false,

    val plans: List<PmPlan> = emptyList(),
    val plansLoading: Boolean = false,
    val plansError: String? = null,
) {
    val fittedTyres: List<AssetTyreRow> get() = tyres.filter { it.isFitted }
    val pastTyres: List<AssetTyreRow> get() = tyres.filterNot { it.isFitted }
}

@HiltViewModel
class AssetDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val assetRepository: AssetRepository,
    private val workspaceManager: WorkspaceManager,
    private val tyreApi: TyreApi,
    private val maintenanceApi: MaintenanceApi,
    private val odometerApi: OdometerApi,
) : ViewModel() {

    private val assetId: String = savedStateHandle["assetId"] ?: ""

    private val _uiState = MutableStateFlow(AssetDetailUiState(isLoading = true))
    val uiState = _uiState.asStateFlow()

    init {
        loadAsset()
    }

    private fun loadAsset() {
        viewModelScope.launch {
            try {
                val workspace = workspaceManager.currentWorkspace.filterNotNull().first()
                val tenantId = workspace.tenant.id
                val realAsset = assetRepository.getAsset(assetId, tenantId)
                _uiState.update { it.copy(asset = realAsset, isLoading = false) }

                // Everything below keys on the asset NUMBER, not the row id. The
                // route argument is the vehicle_fleet primary key; tyre_records,
                // pm_programs and odometer_logs all reference the asset by its
                // number, so none of them can be read until the asset itself has
                // loaded.
                val assetNo = realAsset.assetNumber.takeIf { it.isNotBlank() } ?: return@launch
                loadTyres(assetNo)
                loadPlans(assetNo)
                loadOdometer(assetNo)
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "Failed to load asset", isLoading = false) }
            }
        }
    }

    /**
     * The tyre episodes recorded against this asset.
     *
     * ON THE API CALL. `getTyreHistoryBySerial` is named for its usual caller, but
     * its `or` parameter is a raw PostgREST `or=(...)` group over tyre_records and
     * nothing about it is serial-specific. The group passed here matches the asset
     * across BOTH asset columns, for the same reason the serial version matches
     * three serial columns: the import filled `asset_no` on some rows and
     * `asset_number` on others. Adding a dedicated `asset_no` query to TyreApi would
     * be the tidier home for this, and is the right follow-up.
     *
     * Rows arrive newest fitment first, so the currently-fitted tyres are at the top
     * and a truncated read loses history rather than the live set. The screen still
     * says when the ceiling was hit.
     */
    private suspend fun loadTyres(assetNo: String) {
        _uiState.update { it.copy(tyresLoading = true, tyresError = null) }
        val safe = TyreHistoryDto.sanitizeSerial(assetNo)
        if (safe.isBlank()) {
            _uiState.update { it.copy(tyresLoading = false) }
            return
        }
        runCatching {
            tyreApi.getTyreHistoryBySerial(
                or = "(asset_no.eq.$safe,asset_number.eq.$safe)",
                limit = TYRE_ROW_LIMIT,
            )
        }.onSuccess { rows ->
            _uiState.update {
                it.copy(
                    tyresLoading = false,
                    tyres = rows.mapNotNull(::toTyreRow),
                    tyresTruncated = rows.size >= TYRE_ROW_LIMIT,
                )
            }
        }.onFailure { e ->
            // The list stays empty AND an error is set, so the screen can tell
            // "no tyres recorded" apart from "the tyre read failed".
            _uiState.update {
                it.copy(tyresLoading = false, tyresError = e.message ?: "Could not load tyres for this asset")
            }
        }
    }

    /**
     * Preventive-maintenance programmes for this asset.
     *
     * pm_programs is read for active programmes and narrowed to this asset here,
     * because the endpoint filters on site rather than asset. The due-date banding
     * reuses [MaintenanceViewModel]'s rules so the asset screen and the maintenance
     * module can never disagree about what is late.
     */
    private suspend fun loadPlans(assetNo: String) {
        _uiState.update { it.copy(plansLoading = true, plansError = null) }
        runCatching { maintenanceApi.getPrograms() }
            .onSuccess { rows ->
                val mine = rows
                    .filter { it.assetNo?.trim().equals(assetNo.trim(), ignoreCase = true) }
                    .mapNotNull(::toPlan)
                _uiState.update { it.copy(plansLoading = false, plans = mine) }
            }
            .onFailure { e ->
                _uiState.update {
                    it.copy(plansLoading = false, plansError = e.message ?: "Could not load maintenance programmes")
                }
            }
    }

    /**
     * The newest recorded meter reading.
     *
     * Best-effort: an asset with no reading yet is a real answer, and a failed read
     * simply leaves the figure absent rather than blocking the screen. Either way
     * the metric renders as "Not recorded" - never as 0 km, which would assert a
     * brand-new vehicle.
     */
    private suspend fun loadOdometer(assetNo: String) {
        val reading = runCatching {
            odometerApi.getLatestReading(assetNoEq = "eq.$assetNo").firstOrNull()
        }.getOrNull() ?: return
        _uiState.update {
            it.copy(latestOdometerKm = reading.odometerKm, latestOdometerDate = reading.readingDate?.take(10))
        }
    }

    private fun toTyreRow(dto: TyreHistoryDto): AssetTyreRow? {
        val id = dto.id ?: return null
        return AssetTyreRow(
            id = id,
            serial = dto.serialKey(),
            position = dto.positionKey(),
            brand = dto.brand?.takeIf { it.isNotBlank() },
            size = dto.size?.takeIf { it.isNotBlank() },
            fittedOn = listOf(dto.fitmentDate, dto.issueDate).firstOrNull { !it.isNullOrBlank() }?.take(10),
            removedOn = dto.removalDate?.take(10),
            kmAtFitment = dto.kmAtFitment,
            totalKm = dto.totalKm,
            removalReason = dto.removalReasonText(),
        )
    }

    private fun toPlan(dto: PmProgramDto): PmPlan? {
        val id = dto.id ?: return null
        val days = MaintenanceViewModel.daysToDue(dto.nextDue)
        return PmPlan(
            id = id,
            name = dto.name?.takeIf { it.isNotBlank() } ?: "Unnamed programme",
            assetNo = dto.assetNo,
            site = dto.site,
            nextDue = dto.nextDue?.take(10),
            daysToDue = days,
            nextDueMeter = dto.nextDueMeter,
            meterSource = dto.meterSource,
            priority = dto.priority,
            band = MaintenanceViewModel.bandFor(days),
        )
    }

    companion object {
        /** Matches the API's own default ceiling; used to detect a truncated read. */
        private const val TYRE_ROW_LIMIT = 100
    }
}
