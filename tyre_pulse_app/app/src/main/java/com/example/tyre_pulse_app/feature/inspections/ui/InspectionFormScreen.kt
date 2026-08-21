package com.example.tyre_pulse_app.feature.inspections.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.StatusGreen
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import com.example.tyre_pulse_app.core.model.TyreInspectionReading
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreLayout
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InspectionFormScreen(
    assetId: String,
    onBack: () -> Unit,
    onTyreClick: (String) -> Unit, // Kept for API compatibility, though we handle it internally now
    viewModel: InspectionViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedPosition by remember { mutableStateOf<String?>(null) }
    var showBottomSheet by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val coroutineScope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Vehicle Inspection", fontWeight = FontWeight.ExtraBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
        ) {
            // Asset Info Header
            Card(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("ASSET #$assetId", style = MaterialTheme.typography.labelSmall, color = YellowPrimary, fontWeight = FontWeight.Bold)
                    Text("Inspection in progress", style = MaterialTheme.typography.bodyMedium)
                }
            }

            uiState.recurrenceWarning?.let { recurrence ->
                RecurrenceAdvisoryBanner(recurrence = recurrence)
            }

            // High-Fidelity Interactive Map (Mirroring Expo)
            uiState.asset?.let { asset ->
                VehicleTyreLayout(
                    asset = asset,
                    inspection = uiState.inspection,
                    selectedPosition = selectedPosition,
                    onTyreClick = { pos ->
                        selectedPosition = pos
                        showBottomSheet = true
                    },
                    modifier = Modifier.weight(1f)
                )
            } ?: Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }

            // Control Bar
            Surface(tonalElevation = 8.dp, modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = { viewModel.submit() },
                    modifier = Modifier.fillMaxWidth().padding(20.dp).height(56.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                    shape = RoundedCornerShape(12.dp),
                    enabled = !uiState.isSubmitting
                ) {
                    Text("FINISH INSPECTION", fontWeight = FontWeight.ExtraBold)
                }
            }
        }
    }

    if (showBottomSheet && selectedPosition != null) {
        val currentReading = uiState.inspection?.tyreReadings?.find { it.position == selectedPosition }
        
        ModalBottomSheet(
            onDismissRequest = { showBottomSheet = false },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = { BottomSheetDefaults.DragHandle() }
        ) {
            TyreDetailBottomSheet(
                position = selectedPosition!!,
                initialReading = currentReading,
                onSave = { updatedReading ->
                    viewModel.updateReading(updatedReading)
                    coroutineScope.launch {
                        sheetState.hide()
                        showBottomSheet = false
                        selectedPosition = null
                    }
                },
                onCancel = {
                    coroutineScope.launch {
                        sheetState.hide()
                        showBottomSheet = false
                        selectedPosition = null
                    }
                }
            )
        }
    }
}

@Composable
fun TyreDetailBottomSheet(
    position: String,
    initialReading: TyreInspectionReading?,
    onSave: (TyreInspectionReading) -> Unit,
    onCancel: () -> Unit
) {
    var pressure by remember { mutableStateOf(initialReading?.pressure?.toFloatOrNull() ?: 6.2f) }
    var treadDepth by remember { mutableStateOf(initialReading?.treadDepth?.toFloatOrNull() ?: 6.5f) }
    var condition by remember { mutableStateOf(initialReading?.condition ?: "Good") }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 8.dp)
            .navigationBarsPadding()
    ) {
        Text("Tyre Details: $position", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
        Spacer(modifier = Modifier.height(24.dp))

        // Pressure Section
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            Text("Pressure", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("${String.format("%.1f", pressure)} bar", style = MaterialTheme.typography.titleLarge, color = YellowPrimary, fontWeight = FontWeight.ExtraBold)
        }
        Slider(
            value = pressure,
            onValueChange = { pressure = it },
            valueRange = 0f..15f,
            colors = SliderDefaults.colors(thumbColor = YellowPrimary, activeTrackColor = YellowPrimary)
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Tread Depth Section
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            Text("Tread Depth", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("${String.format("%.1f", treadDepth)} mm", style = MaterialTheme.typography.titleLarge, color = StatusGreen, fontWeight = FontWeight.ExtraBold)
        }
        Slider(
            value = treadDepth,
            onValueChange = { treadDepth = it },
            valueRange = 0f..30f,
            colors = SliderDefaults.colors(thumbColor = StatusGreen, activeTrackColor = StatusGreen)
        )
        
        Spacer(modifier = Modifier.height(24.dp))

        // Condition Section
        Text("Condition", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(12.dp))
        val conditions = listOf("Good", "Cuts", "Bulge", "Crack", "Puncture", "Chunking", "Sidewall Damage", "Other")
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.height(160.dp) // Fixed height to prevent bottom sheet jumping too much
        ) {
            items(conditions) { cond ->
                val isSelected = condition == cond
                Box(
                    modifier = Modifier
                        .height(48.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (isSelected) YellowPrimary else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                        .border(
                            width = 2.dp,
                            color = if (isSelected) YellowPrimary else Color.Transparent,
                            shape = RoundedCornerShape(8.dp)
                        )
                        .clickable { condition = cond },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = cond,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                        color = if (isSelected) Color.Black else MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            OutlinedButton(
                onClick = onCancel,
                modifier = Modifier.weight(1f).height(56.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("CANCEL")
            }
            Button(
                onClick = {
                    onSave(
                        TyreInspectionReading(
                            position = position,
                            pressure = String.format("%.1f", pressure),
                            treadDepth = String.format("%.1f", treadDepth),
                            condition = condition
                        )
                    )
                },
                modifier = Modifier.weight(1f).height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("SAVE", fontWeight = FontWeight.ExtraBold)
            }
        }
        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
fun RecurrenceAdvisoryBanner(recurrence: RecurrenceInfo) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color(0xFFFEF3C7), // Light yellow background
            contentColor = Color(0xFF92400E)  // Dark amber text
        )
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Default.Warning,
                contentDescription = "Warning",
                tint = Color(0xFFF59E0B),
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column {
                Text(
                    text = "Not due for another ${recurrence.dueInDays} days",
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    text = "Last checked ${recurrence.daysAgo} days ago" + 
                           (if (recurrence.documentNo != null) " (${recurrence.documentNo})" else "") +
                           ". You can still proceed if needed.",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}
