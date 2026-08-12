package com.example.tyre_pulse_app.feature.tyres.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.authentication.UserViewModel
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.designsystem.component.TPStatusChip
import com.example.tyre_pulse_app.core.designsystem.component.TPTopBar
import com.example.tyre_pulse_app.core.model.Tyre

@Composable
fun TyreListRoute(
    onTyreClick: (String) -> Unit,
    viewModel: TyreListViewModel = hiltViewModel(),
    userViewModel: UserViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentWorkspace by userViewModel.currentWorkspace.collectAsState()
    val listState = rememberLazyListState()

    Scaffold(
        topBar = {
            Column {
                TPTopBar(
                    title = "Tyres",
                    currentWorkspace = currentWorkspace,
                    onWorkspaceClick = { /* TODO */ }
                )
                OutlinedTextField(
                    value = uiState.searchQuery,
                    onValueChange = viewModel::onSearchQueryChanged,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    placeholder = { Text("Search Tyres (Serial, Brand)...") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    singleLine = true,
                    shape = MaterialTheme.shapes.medium
                )
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (uiState.isLoading && uiState.tyres.isEmpty()) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(uiState.tyres, key = { it.id }) { tyre ->
                        TyreItem(tyre = tyre, onClick = { onTyreClick(tyre.id) })
                    }
                    if (uiState.tyres.isEmpty() && !uiState.isLoading) {
                        item {
                            Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                                Text("No tyres found")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TyreItem(tyre: Tyre, onClick: () -> Unit) {
    TPCard(onClick = onClick) {
        Column(modifier = Modifier.padding(16.dp).fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(text = tyre.serialNumber, style = MaterialTheme.typography.titleMedium)
                TPStatusChip(label = tyre.status.name, statusColor = MaterialTheme.colorScheme.primary)
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(text = "${tyre.brand} • ${tyre.pattern ?: ""} • ${tyre.size ?: ""}", style = MaterialTheme.typography.bodyMedium)
            
            if (tyre.currentAssetNumber != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(text = "Fitted on: ${tyre.currentAssetNumber}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(text = "Pos: ${tyre.position ?: "N/A"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                }
            }
        }
    }
}
