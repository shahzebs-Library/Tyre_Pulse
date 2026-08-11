package com.example.tyre_pulse_app.feature.assets.ui

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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.authentication.UserViewModel
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.designsystem.component.TPStatusChip
import com.example.tyre_pulse_app.core.designsystem.component.TPTopBar
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.AssetStatus

import com.example.tyre_pulse_app.core.designsystem.component.SkeletonList

@Composable
fun AssetListRoute(
    onAssetClick: (String) -> Unit,
    viewModel: AssetListViewModel = hiltViewModel(),
    userViewModel: UserViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentWorkspace by userViewModel.currentWorkspace.collectAsState()
    val listState = rememberLazyListState()

    Scaffold(
        topBar = {
            Column {
                TPTopBar(
                    title = "Assets",
                    currentWorkspace = currentWorkspace,
                    onWorkspaceClick = { /* TODO */ }
                )
                OutlinedTextField(
                    value = uiState.searchQuery,
                    onValueChange = viewModel::onSearchQueryChanged,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    placeholder = { Text("Search Assets...") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    singleLine = true,
                    shape = MaterialTheme.shapes.medium
                )
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (uiState.isLoading && uiState.assets.isEmpty()) {
                SkeletonList()
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(uiState.assets, key = { it.id }) { asset ->
                        AssetItem(asset = asset, onClick = { onAssetClick(asset.id) })
                    }
                    if (uiState.assets.isEmpty() && !uiState.isLoading) {
                        item {
                            Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                                Text("No assets found")
                            }
                        }
                    }
                }
            }
        }
    }
}

import androidx.compose.foundation.Image
import coil.compose.rememberAsyncImagePainter

@Composable
private fun AssetItem(asset: Asset, onClick: () -> Unit) {
    TPCard(onClick = onClick) {
        Row(
            modifier = Modifier.padding(16.dp).fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Agent 50: Visible Asset Pictures
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center
            ) {
                if (asset.imageUrl != null) {
                    Image(
                        painter = rememberAsyncImagePainter(asset.imageUrl),
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Icon(Icons.Default.DirectionsCar, contentDescription = null, tint = MaterialTheme.colorScheme.outline)
                }
            }
            
            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(text = asset.assetNumber, style = MaterialTheme.typography.titleMedium)
                asset.plateNumber?.let {
                    Text(text = it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(text = "${asset.category} • ${asset.type}", style = MaterialTheme.typography.labelSmall)
            }
            val statusColor = when (asset.status) {
                AssetStatus.ACTIVE -> Color(0xFF2E7D32)
                AssetStatus.MAINTENANCE -> Color(0xFFEF6C00)
                else -> MaterialTheme.colorScheme.error
            }
            TPStatusChip(label = asset.status.name, statusColor = statusColor)
        }
    }
}
