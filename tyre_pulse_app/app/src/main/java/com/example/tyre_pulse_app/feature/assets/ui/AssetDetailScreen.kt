package com.example.tyre_pulse_app.feature.assets.ui
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.filled.Warning
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.StatusGreen
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import com.example.tyre_pulse_app.core.designsystem.component.VehicleDiagram3D
import com.example.tyre_pulse_app.core.model.FittedTyre
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun AssetDetailRoute(
    assetId: String,
    onBack: () -> Unit,
    onInspect: (String) -> Unit,
    viewModel: AssetDetailViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    
    AssetDetailScreen(
        assetId = assetId,
        uiState = uiState,
        onBack = onBack,
        onInspect = onInspect
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssetDetailScreen(assetId: String, uiState: AssetDetailUiState, onBack: () -> Unit, onInspect: (String) -> Unit) {
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Overview", "Tyres", "Maintenance", "History")

    val snackbarHostState = remember { SnackbarHostState() }
    var isRefreshing by remember { mutableStateOf(false) }
    
    if (isRefreshing) {
        LaunchedEffect(true) {
            delay(1000)
            isRefreshing = false
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            Column {
                TopAppBar(
                    title = { Text(assetId, fontWeight = FontWeight.Bold) },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                )
                SecondaryScrollableTabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = MaterialTheme.colorScheme.surface,
                    edgePadding = 16.dp,
                    divider = {}
                ) {
                    tabs.forEachIndexed { index, title ->
                        Tab(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            text = { Text(title, style = MaterialTheme.typography.labelLarge) }
                        )
                    }
                }
            }
        },
        bottomBar = {
            if (selectedTab == 0 || selectedTab == 1) {
                Surface(tonalElevation = 8.dp) {
                    Button(
                        onClick = { onInspect(assetId) },
                        modifier = Modifier.fillMaxWidth().padding(16.dp).height(56.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black)
                    ) {
                        Text("Inspect Tyres", fontWeight = FontWeight.Bold)
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
            Column(modifier = Modifier.fillMaxSize()) {
                when (selectedTab) {
                    0 -> AssetOverviewContent(assetId, uiState)
                    1 -> AssetTyreMapContent(assetId)
                    2 -> AssetMaintenanceContent(assetId)
                    3 -> AssetHistoryContent(assetId)
                }
            }
            
        }
    }
}

@Composable
fun AssetOverviewContent(assetId: String, uiState: AssetDetailUiState) {
    Column(modifier = Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        AssetHeaderSection(assetId)
        MetricsGrid()
        
        if (uiState.telemetry.aiRiskMessage != null) {
            Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(12.dp))
                    Text(uiState.telemetry.aiRiskMessage, color = MaterialTheme.colorScheme.onErrorContainer, fontWeight = FontWeight.Bold)
                }
            }
        }

        Text("Live Telemetry", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricCard("Engine Temp", "${String.format("%.1f", uiState.telemetry.engineTemp)} °C", Modifier.weight(1f))
            MetricCard("Oil Pressure", "${String.format("%.1f", uiState.telemetry.oilPressure)} psi", Modifier.weight(1f))
        }

        Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.Black)) {
            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Health Score", color = Color.White, modifier = Modifier.weight(1f))
                val scoreColor = if (uiState.telemetry.healthScore >= 90) StatusGreen else if (uiState.telemetry.healthScore >= 75) YellowPrimary else MaterialTheme.colorScheme.error
                Text("${uiState.telemetry.healthScore}%", style = MaterialTheme.typography.headlineMedium, color = scoreColor, fontWeight = FontWeight.ExtraBold)
            }
        }
    }
}

@Composable
fun AssetTyreMapContent(assetId: String) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text("Bird-View Layout", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        
        val demoTyres = listOf(
            FittedTyre(id = "demo-1", position = "FL", serialNumber = "SN-1001", brand = "Michelin", pattern = "X Multi Z", size = "295/80R22.5", condition = "Good"),
            FittedTyre(id = "demo-2", position = "FR", serialNumber = "SN-1002", brand = "Michelin", pattern = "X Multi Z", size = "295/80R22.5", condition = "Warning"),
            FittedTyre(id = "demo-3", position = "RL1", serialNumber = "SN-1003", brand = "Bridgestone", pattern = "M729", size = "315/80R22.5", condition = "Critical"),
            FittedTyre(id = "demo-4", position = "RR1", serialNumber = "SN-1004", brand = "Bridgestone", pattern = "M729", size = "315/80R22.5", condition = "Good")
        )
        
        VehicleDiagram3D(
            vehicleType = "Truck",
            fittedTyres = demoTyres,
            onTyreClick = { /* handled in inspection */ },
            modifier = Modifier.fillMaxWidth().height(320.dp)
        )
    }
}

@Composable
fun AssetMaintenanceContent(assetId: String) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text("Upcoming Service", fontWeight = FontWeight.Bold)
    }
}

@Composable
fun AssetHistoryContent(assetId: String) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text("Full Audit Trail", fontWeight = FontWeight.Bold)
    }
}

@Composable
fun AssetHeaderSection(assetId: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(64.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant))
            Spacer(Modifier.width(16.dp))
            Column {
                Text("Mixer 2841", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                Text("Mercedes-Benz Actros 4141", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                StatusChip("Active", StatusGreen)
            }
        }
    }
}

@Composable
fun StatusChip(text: String, color: Color) {
    Surface(
        color = color.copy(alpha = 0.1f),
        shape = RoundedCornerShape(4.dp),
        modifier = Modifier.padding(top = 4.dp)
    ) {
        Text(text, color = color, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

@Composable
fun MetricsGrid() {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        MetricCard("Odometer", "125,420 KM", Modifier.weight(1f))
        MetricCard("Hours", "3,640 Hrs", Modifier.weight(1f))
    }
}

@Composable
fun MetricCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            Text(value, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
        }
    }
}
