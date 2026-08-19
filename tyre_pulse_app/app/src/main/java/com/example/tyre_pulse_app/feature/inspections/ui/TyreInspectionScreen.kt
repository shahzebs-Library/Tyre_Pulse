package com.example.tyre_pulse_app.feature.inspections.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.R
import com.example.tyre_pulse_app.core.designsystem.theme.StatusGreen
import com.example.tyre_pulse_app.core.designsystem.theme.StatusRed
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import androidx.compose.animation.core.*
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.example.tyre_pulse_app.core.ai.AITyreScanner
import androidx.compose.material.icons.filled.Camera
import androidx.compose.material.icons.filled.Close

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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TreadStep(uiState: TyreInspectionUiState, viewModel: TyreInspectionViewModel) {
    var showAiScanDialog by remember { mutableStateOf(false) }

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

        Spacer(Modifier.height(48.dp))

        Button(
            onClick = { showAiScanDialog = true },
            modifier = Modifier.fillMaxWidth().height(60.dp),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            shape = RoundedCornerShape(16.dp)
        ) {
            Icon(Icons.Default.Camera, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("SCAN TREAD WITH AI CAMERA", fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp)
        }
    }

    if (showAiScanDialog) {
        Dialog(
            onDismissRequest = { showAiScanDialog = false },
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Surface(modifier = Modifier.fillMaxSize(), color = Color.Black) {
                var progress by remember { mutableStateOf(0f) }
                var scanComplete by remember { mutableStateOf(false) }
                
                LaunchedEffect(Unit) {
                    while (progress < 1.0f) {
                        kotlinx.coroutines.delay(150)
                        progress += 0.08f
                    }
                    progress = 1.0f
                    scanComplete = true
                }

                val infiniteTransition = rememberInfiniteTransition(label = "laser")
                val laserY by infiniteTransition.animateFloat(
                    initialValue = 0.1f,
                    targetValue = 0.9f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(1500, easing = LinearEasing),
                        repeatMode = RepeatMode.Reverse
                    ),
                    label = "laserY"
                )

                Box(modifier = Modifier.fillMaxSize()) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(Color(0xFF1E293B)),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.Camera, contentDescription = null, tint = Color.White.copy(alpha = 0.3f), modifier = Modifier.size(96.dp))
                            Spacer(Modifier.height(16.dp))
                            Text("AI TREAD PROFILE DETECTOR", color = Color.White.copy(alpha = 0.6f), fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                        }
                    }

                    Box(
                        modifier = Modifier
                            .size(280.dp)
                            .align(Alignment.Center)
                            .border(3.dp, if (scanComplete) StatusGreen else Color.White, RoundedCornerShape(24.dp))
                    ) {
                        if (!scanComplete) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .fillMaxHeight(0.02f)
                                    .align(Alignment.TopCenter)
                                    .offset(y = 280.dp * laserY)
                                    .background(Color.Red.copy(alpha = 0.8f))
                            )
                        }
                    }

                    IconButton(
                        onClick = { showAiScanDialog = false },
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(24.dp)
                    ) {
                        Icon(Icons.Default.Close, contentDescription = null, tint = Color.White)
                    }

                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .align(Alignment.BottomCenter),
                        color = Color(0xFF0F172A),
                        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
                    ) {
                        Column(
                            modifier = Modifier
                                .padding(24.dp)
                                .navigationBarsPadding(),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            if (!scanComplete) {
                                Text("Analyzing tread grooves... Keep steady", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                Spacer(Modifier.height(12.dp))
                                LinearProgressIndicator(
                                    progress = { progress },
                                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(CircleShape),
                                    color = MaterialTheme.colorScheme.primary,
                                    trackColor = Color.White.copy(alpha = 0.1f)
                                )
                                Spacer(Modifier.height(12.dp))
                                Text("${(progress * 100).toInt()}% COMPLETE", color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp, fontWeight = FontWeight.ExtraBold)
                            } else {
                                val analysis = AITyreScanner.analyzeTreadDepth(
                                    kmAtFitment = uiState.kmAtFitment,
                                    currentKm = uiState.currentKm,
                                    vehicleType = uiState.vehicleType,
                                    siteType = uiState.siteType
                                )

                                Text("SCAN COMPLETE", color = StatusGreen, fontWeight = FontWeight.ExtraBold, letterSpacing = 2.sp, fontSize = 14.sp)
                                Spacer(Modifier.height(16.dp))
                                
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Column {
                                        Text("ESTIMATED TREAD", color = Color.White.copy(alpha = 0.5f), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                        Text("${analysis.treadDepthMm} mm", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                                    }
                                    Column {
                                        Text("PREDICTED LIFE", color = Color.White.copy(alpha = 0.5f), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                        Text("${analysis.remainingLifeKm} km", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                                    }
                                }
                                
                                Spacer(Modifier.height(16.dp))
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .background(Color.White.copy(alpha = 0.05f), RoundedCornerShape(12.dp))
                                        .padding(12.dp)
                                ) {
                                    Column {
                                        Text("Wear pattern: ${analysis.wearPattern}", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                        Text("Est. replacement: ${analysis.replacementDate}", color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp)
                                    }
                                }

                                Spacer(Modifier.height(24.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                    OutlinedButton(
                                        onClick = {
                                            progress = 0f
                                            scanComplete = false
                                        },
                                        modifier = Modifier.weight(1f).height(60.dp),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)
                                    ) {
                                        Text("RETAKE")
                                    }
                                    Button(
                                        onClick = {
                                            viewModel.onTreadDepthChanged(analysis.treadDepthMm)
                                            showAiScanDialog = false
                                        },
                                        modifier = Modifier.weight(1f).height(60.dp)
                                    ) {
                                        Text("ACCEPT SCAN")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ConditionStep(uiState: TyreInspectionUiState, viewModel: TyreInspectionViewModel) {
    val conditions = listOf("Good", "Cuts", "Bulge", "Crack", "Puncture", "Chunking", "Sidewall Damage", "Other")
    
    Column(modifier = Modifier.padding(16.dp).fillMaxSize()) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Tyre Condition", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        
        Spacer(Modifier.height(24.dp))
        
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
                .clickable { 
                    viewModel.onPhotoAdded("file:///durable_photos/inspection_${System.currentTimeMillis()}.jpg")
                },
            contentAlignment = Alignment.Center
        ) {
            if (uiState.photos.isNotEmpty()) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Check, contentDescription = null, tint = StatusGreen, modifier = Modifier.size(48.dp))
                    Text("${uiState.photos.size} Photos Captured", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text("Tap to capture another", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Camera, contentDescription = null, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("Tap to capture photo", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}
