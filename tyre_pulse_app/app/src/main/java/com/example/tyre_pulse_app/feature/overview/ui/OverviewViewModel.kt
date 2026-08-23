package com.example.tyre_pulse_app.feature.overview.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.network.api.AnalyticsApi
import com.example.tyre_pulse_app.core.network.api.AnalyticsRpcBody
import com.example.tyre_pulse_app.feature.overview.model.CountryScope
import com.example.tyre_pulse_app.feature.overview.model.OverviewPeriod
import com.example.tyre_pulse_app.feature.overview.model.OverviewSnapshot
import com.example.tyre_pulse_app.feature.overview.model.buildOverview
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

/**
 * Fleet Overview.
 *
 * DATA SOURCE, AND WHY IT IS THIS ONE.
 *
 * One call to the `get_mobile_analytics` RPC per scope change. The server
 * aggregates and returns a single row; this device never reads a table row.
 *
 * The Expo screen this replaces did the opposite - it paged all 11,205
 * `tyre_records` rows onto the phone (1,000 at a time) and counted them in
 * memory so its filters could be applied client-side. That is the shape of read
 * that made the predecessor app unusable on the low-end handsets this fleet
 * carries, and it is not repeated here. Every filter on this screen is a server
 * argument (`p_country`, `p_from`, `p_to`, `p_site`), not an in-memory pass.
 *
 * THREE STATES, THREE MEANINGS. Loading, "we could not load it", and "there is
 * nothing in this scope" are separate fields and render differently. An error
 * that renders as an empty fleet is a lie about the fleet.
 */
data class OverviewUiState(
    val isLoading: Boolean = false,
    /** Non-null only when the read actually failed. Never set for an empty result. */
    val error: String? = null,
    /** True once a read has completed, so an empty screen is known-empty. */
    val loaded: Boolean = false,

    val period: OverviewPeriod = OverviewPeriod.MONTHS_12,
    val country: CountryScope = CountryScope.ALL,
    val site: String? = null,

    val snapshot: OverviewSnapshot? = null,
    /** Window described in words, so an exported or forwarded figure is readable. */
    val windowLabel: String = "",
) {
    val hasFilters: Boolean
        get() = period != OverviewPeriod.MONTHS_12 || country != CountryScope.ALL || site != null
}

@HiltViewModel
class OverviewViewModel @Inject constructor(
    private val analyticsApi: AnalyticsApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(OverviewUiState())
    val uiState = _uiState.asStateFlow()

    init { load() }

    fun setPeriod(period: OverviewPeriod) {
        if (period == _uiState.value.period) return
        _uiState.update { it.copy(period = period) }
        load()
    }

    fun setCountry(country: CountryScope) {
        if (country == _uiState.value.country) return
        // A site chosen under one country is meaningless under another, so it is
        // dropped rather than silently carried into a scope where it matches nothing.
        _uiState.update { it.copy(country = country, site = null) }
        load()
    }

    fun setSite(site: String?) {
        if (site == _uiState.value.site) return
        _uiState.update { it.copy(site = site) }
        load()
    }

    fun clearFilters() {
        _uiState.update {
            it.copy(
                period = OverviewPeriod.MONTHS_12,
                country = CountryScope.ALL,
                site = null,
            )
        }
        load()
    }

    fun load() {
        val state = _uiState.value
        val today = LocalDate.now()

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = runCatching {
                analyticsApi.getMobileAnalytics(
                    AnalyticsRpcBody(
                        pCountry = state.country.queryValue,
                        pFrom = state.period.fromDate(today)?.toString(),
                        pTo = state.period.toDate(today)?.toString(),
                        pSite = state.site,
                    )
                )
            }

            result.fold(
                onSuccess = { analytics ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            loaded = true,
                            error = null,
                            snapshot = buildOverview(analytics, state.country),
                            windowLabel = state.period.describe(today),
                        )
                    }
                },
                onFailure = { e ->
                    // The previous snapshot is kept deliberately: a failed refresh
                    // should not blank a figure the user was already reading. The
                    // banner above it says the figures are the last ones that loaded.
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = e.message ?: "The fleet overview could not be loaded.",
                        )
                    }
                },
            )
        }
    }
}
