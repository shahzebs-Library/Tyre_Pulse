package com.example.tyre_pulse_app.feature.records.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.feature.records.data.RecordsRepository
import com.example.tyre_pulse_app.feature.records.model.TyreRecord
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class RecordsUiState {
    object Loading : RecordsUiState()
    data class Success(val records: List<TyreRecord>, val hasMore: Boolean) : RecordsUiState()
    data class Error(val message: String) : RecordsUiState()
}

@OptIn(FlowPreview::class)
@HiltViewModel
class RecordsViewModel @Inject constructor(
    private val repository: RecordsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<RecordsUiState>(RecordsUiState.Loading)
    val uiState: StateFlow<RecordsUiState> = _uiState.asStateFlow()

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _siteFilter = MutableStateFlow<String?>(null)
    val siteFilter: StateFlow<String?> = _siteFilter.asStateFlow()

    private val _riskFilter = MutableStateFlow<String?>(null)
    val riskFilter: StateFlow<String?> = _riskFilter.asStateFlow()

    private var currentPage = 0
    private var allRecords = mutableListOf<TyreRecord>()
    private var isPaginating = false
    private var hasMore = true

    init {
        // Debounce search
        viewModelScope.launch {
            @Suppress("OPT_IN_USAGE")
            _searchQuery.debounce(350)
                .drop(1) // Skip initial empty value trigger
                .collect {
                    resetAndLoad()
                }
        }
        
        loadRecords()
    }

    fun onSearchQueryChanged(query: String) {
        _searchQuery.value = query
    }

    fun setSiteFilter(site: String?) {
        _siteFilter.value = site
        resetAndLoad()
    }

    fun setRiskFilter(risk: String?) {
        _riskFilter.value = risk
        resetAndLoad()
    }

    private fun resetAndLoad() {
        currentPage = 0
        hasMore = true
        allRecords.clear()
        _uiState.value = RecordsUiState.Loading
        loadRecords()
    }

    fun loadMore() {
        if (!hasMore || isPaginating || _uiState.value is RecordsUiState.Loading) return
        currentPage++
        loadRecords()
    }

    private fun loadRecords() {
        isPaginating = true
        viewModelScope.launch {
            try {
                val newRecords = repository.getTyreRecords(
                    page = currentPage,
                    site = _siteFilter.value,
                    risk = _riskFilter.value,
                    searchQuery = _searchQuery.value
                )
                
                if (newRecords.size < 30) {
                    hasMore = false
                }
                
                allRecords.addAll(newRecords)
                _uiState.value = RecordsUiState.Success(allRecords.toList(), hasMore)
            } catch (e: Exception) {
                if (currentPage == 0) {
                    _uiState.value = RecordsUiState.Error(e.message ?: "Failed to load records")
                }
            } finally {
                isPaginating = false
            }
        }
    }
}
