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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.R
import com.example.tyre_pulse_app.core.designsystem.theme.StatusGreen
import com.example.tyre_pulse_app.core.designsystem.theme.StatusRed
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TyreInspectionRoute(
    onBack: () -> Unit,
    viewModel: TyreInspectionViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    
    if (uiState.isSaved) {
        LaunchedEffect(Unit) { onBack() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Column {
                        Text("Inspect Tyre", style = MaterialTheme.typography.titleMedium)
                        Text(uiState.position, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        bottomBar = {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                tonalElevation = 8.dp
            ) {
                Row(
                    modifier = Modifier.padding(16.dp).navigationBarsPadding(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    if (uiState.currentStep != InspectionStep.PRESSURE) {
                        OutlinedButton(
                            onClick = { viewModel.previousStep() },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text(stringResource(R.string.back))
                        }
                    }
                    Button(
                        onClick = { 
                            if (uiState.currentStep == InspectionStep.PHOTOS) viewModel.saveReading()
                            else viewModel.nextStep()
                        },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black)
                    ) {
                        Text(if (uiState.currentStep == InspectionStep.PHOTOS) stringResource(R.string.submit) else stringResource(R.string.next))
                    }
                }
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            StepIndicator(uiState.currentStep)
            
            when (uiState.currentStep) {
                InspectionStep.PRESSURE -> PressureStep(uiState, viewModel)
                InspectionStep.TREAD -> TreadStep(uiState, viewModel)
                InspectionStep.CONDITION -> ConditionStep(uiState, viewModel)
                InspectionStep.PHOTOS -> PhotosStep(uiState, viewModel)
            }
        }
    }
}

@Composable
fun StepIndicator(currentStep: InspectionStep) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        InspectionStep.entries.forEach { step ->
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(
                        if (step.ordinal <= currentStep.ordinal) YellowPrimary 
                        else MaterialTheme.colorScheme.surfaceVariant
                    )
            )
        }
    }
}

@Composable
fun PressureStep(uiState: TyreInspectionUiState, viewModel: TyreInspectionViewModel) {
    Column(modifier = Modifier.padding(16.dp).fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Pressure", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(32.dp))
        
        Text(
            text = "${uiState.pressure ?: 6.2} bar",
            style = MaterialTheme.typography.displayMedium,
            fontWeight = FontWeight.Bold,
            color = YellowPrimary
        )
        Text("Recommended: 9.0 - 10.0 bar", style = MaterialTheme.typography.labelMedium, color = StatusRed)
        
        Spacer(Modifier.height(48.dp))
        
        Slider(
            value = uiState.pressure ?: 6.2f,
            onValueChange = { viewModel.onPressureChanged(it) },
            valueRange = 0f..15f,
            modifier = Modifier.fillMaxWidth(),
            colors = SliderDefaults.colors(thumbColor = YellowPrimary, activeTrackColor = YellowPrimary)
        )
        
        Spacer(Modifier.height(32.dp))
        
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
        ) {
            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Temperature", style = MaterialTheme.typography.labelMedium)
                    Text("${uiState.temperature ?: 62}°C", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                Box(modifier = Modifier.size(40.dp).clip(CircleShape).background(StatusRed.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
                    Text("High", color = StatusRed, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun TreadStep(uiState: TyreInspectionUiState, viewModel: TyreInspectionViewModel) {
    Column(modifier = Modifier.padding(16.dp).fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Tread Depth", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(32.dp))
        
        Text(
            text = "${uiState.treadDepth ?: 6.5} mm",
            style = MaterialTheme.typography.displayMedium,
            fontWeight = FontWeight.Bold,
            color = StatusGreen
        )
        Text("Recommended: > 3.0 mm", style = MaterialTheme.typography.labelMedium, color = StatusGreen)
        
        Spacer(Modifier.height(48.dp))
        
        Slider(
            value = uiState.treadDepth ?: 6.5f,
            onValueChange = { viewModel.onTreadDepthChanged(it) },
            valueRange = 0f..30f,
            modifier = Modifier.fillMaxWidth(),
            colors = SliderDefaults.colors(thumbColor = StatusGreen, activeTrackColor = StatusGreen)
        )
    }
}

@Composable
fun ConditionStep(uiState: TyreInspectionUiState, viewModel: TyreInspectionViewModel) {
    val conditions = listOf("Good", "Cuts", "Bulge", "Crack", "Puncture", "Chunking", "Sidewall Damage", "Other")
    
    Column(modifier = Modifier.padding(16.dp).fillMaxSize()) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Tyre Condition", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            
            // Agent 44: Floating Flashlight for dark chassis areas
            IconButton(onClick = { /* TODO: Toggle Torch */ }) {
                Icon(painter = painterResource(id = android.R.drawable.ic_menu_compass), contentDescription = "Flashlight")
            }
        }
        
        Spacer(Modifier.height(24.dp))
        
        // Voice Input Toggle (Agent 42)
        Button(
            onClick = { /* TODO: Start STT */ },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary)
        ) {
            Icon(painter = painterResource(id = android.R.drawable.ic_btn_speak_now), contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Dictate Notes")
        }

        Spacer(Modifier.height(16.dp))
        
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(conditions) { cond ->
                val isSelected = uiState.condition == cond
                Box(
                    modifier = Modifier
                        .height(60.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (isSelected) YellowPrimary else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                        .border(
                            width = 2.dp,
                            color = if (isSelected) YellowPrimary else Color.Transparent,
                            shape = RoundedCornerShape(12.dp)
                        )
                        .clickable { viewModel.onConditionSelected(cond) },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = cond,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (isSelected) Color.Black else MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }
    }
}

@Composable
fun PhotosStep(uiState: TyreInspectionUiState, viewModel: TyreInspectionViewModel) {
    Column(modifier = Modifier.padding(16.dp).fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Evidence Photos", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(32.dp))
        
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(200.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .clickable { /* TODO: Launch Camera */ },
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(48.dp))
                Text("Tap to capture photo", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
