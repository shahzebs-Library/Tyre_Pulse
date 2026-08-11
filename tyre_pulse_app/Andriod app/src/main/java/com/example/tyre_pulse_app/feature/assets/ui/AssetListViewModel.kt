package com.example.tyre_pulse_app.feature.assets.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
import com.example.tyre_pulse_app.core.model.Asset
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AssetListUiState(
    val assets: List<Asset> = emptyList(),
    val isLoading: Boolean = false,
    val searchQuery: String = "",
    val error: String? = null
)

import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.example.tyre_pulse_app.core.data.paging.AssetPagingSource
import com.example.tyre_pulse_app.core.network.api.AssetApi

@HiltViewModel
class AssetListViewModel @Inject constructor(
    private val assetApi: AssetApi,
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val _query = savedStateHandle.getStateFlow("query", "")

    // Agent 33: Scalable Flow
    val assetPagingData: Flow<PagingData<Asset>> = _query.flatMapLatest { query ->
        Pager(
            config = PagingConfig(pageSize = 20, enablePlaceholders = true),
            pagingSourceFactory = { AssetPagingSource(assetApi, query) }
        ).flow.cachedIn(viewModelScope)
    }

    fun onSearchQueryChanged(query: String) {
        savedStateHandle["query"] = query
    }
}
