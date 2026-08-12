package com.example.tyre_pulse_app.feature.search.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.Tyre

@Composable
fun GlobalSearchRoute(
    onAssetClick: (String) -> Unit,
    onTyreClick: (String) -> Unit,
    viewModel: GlobalSearchViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    GlobalSearchScreen(
        uiState = uiState,
        onQueryChanged = viewModel::onQueryChanged,
        onAssetClick = onAssetClick,
        onTyreClick = onTyreClick
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlobalSearchScreen(
    uiState: GlobalSearchUiState,
    onQueryChanged: (String) -> Unit,
    onAssetClick: (String) -> Unit,
    onTyreClick: (String) -> Unit
) {
    Scaffold(
        topBar = {
            SearchBar(
                query = uiState.query,
                onQueryChange = onQueryChanged,
                onSearch = {},
                active = true,
                onActiveChange = {},
                placeholder = { Text("Search assets or serial numbers...") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                modifier = Modifier.fillMaxWidth()
            ) {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    if (uiState.assetResults.isNotEmpty()) {
                        item { CategoryHeader("Assets") }
                        items(uiState.assetResults) { asset ->
                            ListItem(
                                headlineContent = { Text(asset.assetNumber) },
                                supportingContent = { Text("${asset.type} • ${asset.site ?: "Unassigned"}") },
                                modifier = Modifier.clickable { onAssetClick(asset.id) }
                            )
                        }
                    }

                    if (uiState.tyreResults.isNotEmpty()) {
                        item { CategoryHeader("Tyres") }
                        items(uiState.tyreResults) { tyre ->
                            ListItem(
                                headlineContent = { Text(tyre.serialNumber) },
                                supportingContent = { Text("${tyre.brand} • ${tyre.size}") },
                                modifier = Modifier.clickable { onTyreClick(tyre.id) }
                            )
                        }
                    }
                }
            }
        }
    ) { padding ->
        Box(Modifier.padding(padding))
    }
}

@Composable
private fun CategoryHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(16.dp),
        fontWeight = FontWeight.Bold
    )
}
