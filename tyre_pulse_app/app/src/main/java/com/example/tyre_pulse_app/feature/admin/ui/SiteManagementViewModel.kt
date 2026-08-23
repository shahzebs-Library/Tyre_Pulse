package com.example.tyre_pulse_app.feature.admin.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.network.api.AssetApi
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Sites, derived from the fleet register.
 *
 * WHAT THIS REPLACED. Four invented sites - "Qiddiya Site", "NEOM Hub", "Dammam
 * Port", "Riyadh Logistics" - hard-coded into the screen. They were plausible enough
 * to pass for a real network and were the same four for every organisation using the
 * app.
 *
 * Sites are now read from `vehicle_fleet.site`, the column every other screen in
 * this app already groups by.
 *
 * TWO LIMITS THIS MODEL PUBLISHES RATHER THAN HIDES:
 *
 * 1. A site only appears here if at least one asset is registered to it. This is a
 *    view of the fleet register, not a site master - there is no sites API in this
 *    app - so a site standing empty is invisible. [SiteManagementUiState] carries
 *    that caveat so the screen can state it.
 *
 * 2. The read is paged and bounded. If the cap is reached, [SiteManagementUiState.truncated]
 *    is set and the screen says the list may be incomplete, because a silently
 *    short list of sites is indistinguishable from a small fleet.
 *
 * Assets with no site recorded are counted into [SiteManagementUiState.assetsWithoutSite]
 * and never folded into a named site, which would move real machines onto a site
 * nobody assigned them to.
 */
data class SiteSummary(
    val name: String,
    val assetCount: Int,
)

data class SiteManagementUiState(
    val sites: List<SiteSummary> = emptyList(),
    val assetsWithoutSite: Int = 0,
    val assetsRead: Int = 0,
    val truncated: Boolean = false,
    val isLoading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class SiteManagementViewModel @Inject constructor(
    private val assetApi: AssetApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SiteManagementUiState())
    val uiState = _uiState.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val assets = mutableListOf<com.example.tyre_pulse_app.core.model.Asset>()
            var truncated = false
            var failure: Throwable? = null

            // PostgREST caps a response server-side whatever is asked for, so the
            // register is read in Range-bounded pages. A short page ends the read;
            // hitting PAGE_LIMIT means there may be more, which is reported rather
            // than silently dropped.
            for (page in 0 until PAGE_LIMIT) {
                val from = page * PAGE_SIZE
                val to = from + PAGE_SIZE - 1
                val result = runCatching { assetApi.getAssets(range = "$from-$to") }
                val rows = result.getOrElse { e ->
                    failure = e
                    null
                } ?: break

                assets += rows
                if (rows.size < PAGE_SIZE) break
                if (page == PAGE_LIMIT - 1) truncated = true
            }

            // A failure on the FIRST page means we saw nothing at all - that is an
            // error, not an empty fleet. A failure part-way through still leaves a
            // usable partial list, which is reported as possibly incomplete.
            if (failure != null && assets.isEmpty()) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = failure?.message ?: "Could not load sites",
                    )
                }
                return@launch
            }

            val named = assets.mapNotNull { it.site?.trim()?.takeIf { s -> s.isNotEmpty() } }
            val sites = named
                .groupingBy { it }
                .eachCount()
                .map { (name, count) -> SiteSummary(name = name, assetCount = count) }
                .sortedByDescending { it.assetCount }

            _uiState.update {
                it.copy(
                    isLoading = false,
                    sites = sites,
                    assetsWithoutSite = assets.size - named.size,
                    assetsRead = assets.size,
                    truncated = truncated || failure != null,
                )
            }
        }
    }

    private companion object {
        const val PAGE_SIZE = 1000
        const val PAGE_LIMIT = 5
    }
}
