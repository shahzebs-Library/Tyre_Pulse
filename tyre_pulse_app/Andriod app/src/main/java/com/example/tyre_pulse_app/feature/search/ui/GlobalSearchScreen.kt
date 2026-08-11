package com.example.tyre_pulse_app.feature.search.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.component.TPTopBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlobalSearchRoute(
    onAssetClick: (String) -> Unit,
    onTyreClick: (String) -> Unit,
    viewModel: GlobalSearchViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            Column {
                TPTopBar(title = "Global Search")
                OutlinedTextField(
                    value = uiState.query,
                    onValueChange = viewModel::onQueryChanged,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    placeholder = { Text("Search assets, tyres, jobs...") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    shape = MaterialTheme.shapes.medium,
                    trailingIcon = {
                        if (uiState.isLoading) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        }
                    }
                )
            }
        }
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (uiState.result.assets.isNotEmpty()) {
                item { SearchHeader("Assets") }
                items(uiState.result.assets) { asset ->
                    ListItem(
                        headlineContent = { Text(asset.assetNumber) },
                        supportingContent = { Text("${asset.type} • ${asset.site ?: ""}") },
                        modifier = Modifier.clickable { onAssetClick(asset.id) }
                    )
                }
            }
            
            if (uiState.result.tyres.isNotEmpty()) {
                item { SearchHeader("Tyres") }
                items(uiState.result.tyres) { tyre ->
                    ListItem(
                        headlineContent = { Text(tyre.serialNumber) },
                        supportingContent = { Text("${tyre.brand} • ${tyre.size ?: ""}") },
                        modifier = Modifier.clickable { onTyreClick(tyre.id) }
                    )
                }
            }

            if (uiState.query.length >= 2 && uiState.result.assets.isEmpty() && uiState.result.tyres.isEmpty() && !uiState.isLoading) {
                item {
                    Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                        Text("No results found for \"${uiState.query}\"")
                    }
                }
            }
        }
    }
}

@Composable
fun SearchHeader(title: String) {
    Text(
        text = title,
        modifier = Modifier.padding(16.dp),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary
    )
    HorizontalDivider()
}
