package com.example.tyre_pulse_app.feature.assets.ui
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import kotlinx.coroutines.launch
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import coil.compose.AsyncImage
import com.example.tyre_pulse_app.R
import com.example.tyre_pulse_app.core.designsystem.theme.*
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.AssetStatus

@Composable
fun AssetListRoute(
    onAssetClick: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: AssetListViewModel = hiltViewModel()
) {
    val assets = viewModel.assets.collectAsLazyPagingItems()
    val searchQuery by viewModel.searchQuery.collectAsState()
    var selectedFilter by remember { mutableStateOf("TYRES") }

    AssetListScreen(
        assets = assets,
        searchQuery = searchQuery,
        selectedFilter = selectedFilter,
        onSearchQueryChanged = viewModel::onSearchQueryChanged,
        onFilterChanged = { selectedFilter = it },
        onAssetClick = onAssetClick,
        onBack = onBack
    )
}



@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssetListScreen(
    assets: LazyPagingItems<Asset>,
    searchQuery: String,
    selectedFilter: String,
    onSearchQueryChanged: (String) -> Unit,
    onFilterChanged: (String) -> Unit,
    onAssetClick: (String) -> Unit,
    onBack: () -> Unit
) {
    var expandedId by remember { mutableStateOf<String?>(null) }
    
    var isRefreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    if (isRefreshing) {
        LaunchedEffect(true) {
            assets.refresh()
            isRefreshing = false
        }
    }

    LaunchedEffect(assets.loadState.refresh) {
        if (assets.loadState.refresh is LoadState.Error) {
            val e = (assets.loadState.refresh as LoadState.Error).error
            scope.launch {
                snackbarHostState.showSnackbar(e.message ?: "Failed to load assets")
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = OLED_Black,
        topBar = {
            Column(modifier = Modifier.background(OLED_Black)) {
                TopAppBar(
                    title = {
                        Column {
                            Text("Fleet Hub", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                            Text("${assets.itemCount} Vehicles in Fleet", style = MaterialTheme.typography.labelSmall, color = TextSecondary)
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = OLED_Black)
                )
                
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = onSearchQueryChanged,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                    placeholder = { Text("Search asset, serial, site...", color = TextSecondary) },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = YellowPrimary) },
                    shape = RoundedCornerShape(12.dp),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = OLED_Card,
                        unfocusedContainerColor = OLED_Card,
                        focusedBorderColor = YellowPrimary,
                        unfocusedBorderColor = Color.White.copy(alpha = 0.1f)
                    )
                )

                LazyRow(
                    modifier = Modifier.padding(vertical = 12.dp),
                    contentPadding = PaddingValues(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val filters = listOf("TYRES", "ALL", "TM", "MP", "WL", "SL", "PL")
                    items(filters) { filter ->
                        FilterChip(
                            selected = selectedFilter == filter,
                            onClick = { onFilterChanged(filter) },
                            label = { Text(filter, fontWeight = FontWeight.Bold) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = YellowPrimary,
                                selectedLabelColor = Color.Black,
                                containerColor = OLED_Card,
                                labelColor = TextSecondary
                            ),
                            border = FilterChipDefaults.filterChipBorder(
                                enabled = true,
                                selected = selectedFilter == filter,
                                borderColor = Color.White.copy(alpha = 0.1f),
                                selectedBorderColor = YellowPrimary
                            )
                        )
                    }
                }
            }
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true },
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                
        
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(assets.itemCount) { index ->
                    assets[index]?.let { asset ->
                        HighFidelityAssetCard(
                            asset = asset,
                            isExpanded = expandedId == asset.id,
                            onExpandToggle = { expandedId = if (expandedId == asset.id) null else asset.id },
                            onDetailsClick = { onAssetClick(asset.id) }
                        )
                    }
                }

                if (assets.loadState.append is LoadState.Loading) {
                    item { LoadingIndicator() }
                }
            }

            if (assets.loadState.refresh is LoadState.Loading && !isRefreshing) {
                LoadingIndicator(modifier = Modifier.align(Alignment.Center))
            }
            
            
        }
    }
}

@Composable
fun HighFidelityAssetCard(
    asset: Asset,
    isExpanded: Boolean,
    onExpandToggle: () -> Unit,
    onDetailsClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth().animateContentSize(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = OLED_Card),
        border = androidx.compose.foundation.BorderStroke(
            width = if (isExpanded) 1.dp else 0.5.dp,
            color = if (isExpanded) YellowPrimary.copy(alpha = 0.3f) else Color.White.copy(alpha = 0.05f)
        )
    ) {
        Column {
            Row(
                modifier = Modifier.clickable { onExpandToggle() }.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(YellowPrimary.copy(alpha = 0.1f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.LocalShipping, contentDescription = null, tint = YellowPrimary)
                }
                
                Spacer(Modifier.width(16.dp))
                
                Column(modifier = Modifier.weight(1f)) {
                    Text(asset.assetNumber, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                    Text(
                        text = "${asset.make ?: ""} ${asset.model ?: ""} • ${asset.type ?: "Truck"}".trim(),
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary
                    )
                    Text(
                        text = "${asset.site ?: "No Site"} • ${asset.currentKm ?: 0} KM",
                        style = MaterialTheme.typography.labelSmall,
                        color = YellowPrimary,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }

                Column(horizontalAlignment = Alignment.End) {
                    StatusBadge(asset.status)
                    Icon(
                        imageVector = if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = null,
                        tint = TextSecondary,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }

            if (isExpanded) {
                HorizontalDivider(color = Color.White.copy(alpha = 0.05f))
                Column(modifier = Modifier.background(Color.White.copy(alpha = 0.02f)).padding(16.dp)) {
                    AssetDetailGrid(asset)
                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = onDetailsClick,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("VIEW FULL HISTORY", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
fun AssetDetailGrid(asset: Asset) {
    val details = listOf(
        "FLEET NO" to (asset.assetNumber),
        "REG NO" to (asset.plateNumber ?: "-"),
        "TYPE" to (asset.type ?: "-"),
        "YEAR" to (asset.latestInspectionDate?.take(4) ?: "-"),
        "SITE" to (asset.site ?: "-"),
        "OPERATOR" to ("John Doe")
    )

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        details.chunked(2).forEach { row ->
            Row(modifier = Modifier.fillMaxWidth()) {
                row.forEach { (label, value) ->
                    Column(modifier = Modifier.weight(1f)) {
                        Text(label, style = MaterialTheme.typography.labelSmall, color = TextSecondary, letterSpacing = 0.5.sp)
                        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = TextPrimary)
                    }
                }
            }
        }
    }
}

@Composable
fun StatusBadge(status: AssetStatus) {
    val color = when (status) {
        AssetStatus.ACTIVE -> StatusGreen
        AssetStatus.MAINTENANCE -> StatusOrange
        AssetStatus.OUT_OF_SERVICE, AssetStatus.ACCIDENT -> StatusRed
    }
    Surface(
        color = color.copy(alpha = 0.15f),
        shape = RoundedCornerShape(6.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, color.copy(alpha = 0.3f))
    ) {
        Text(
            text = status.name,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            color = color,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.ExtraBold
        )
    }
}

@Composable
fun LoadingIndicator(modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = YellowPrimary, strokeWidth = 3.dp)
    }
}

@Composable
fun ErrorItem(message: String) {
    Text(text = message, color = StatusRed, modifier = Modifier.fillMaxWidth().padding(16.dp))
}
