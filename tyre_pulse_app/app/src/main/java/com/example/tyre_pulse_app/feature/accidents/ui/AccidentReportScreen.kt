package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import com.example.tyre_pulse_app.core.model.Accident

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccidentReportRoute(
    onBack: () -> Unit,
    viewModel: AccidentReportViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    if (uiState.isSubmitted) {
        SuccessOverlay(onBack)
    } else {
        AccidentReportScreen(
            uiState = uiState,
            onBack = onBack,
            onNext = viewModel::nextStep,
            onPrevious = viewModel::previousStep,
            onUpdate = viewModel::updateAccident,
            onSubmit = viewModel::submit
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccidentReportScreen(
    uiState: AccidentReportUiState,
    onBack: () -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onUpdate: ((Accident) -> Accident) -> Unit,
    onSubmit: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Column {
                        Text("Report Accident", fontWeight = FontWeight.ExtraBold)
                        Text("Step ${uiState.currentStep} of 7", style = MaterialTheme.typography.labelSmall, color = YellowPrimary)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = if (uiState.currentStep == 1) onBack else onPrevious) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        bottomBar = {
            BottomActionBar(
                currentStep = uiState.currentStep,
                isLoading = uiState.isLoading,
                onNext = onNext,
                onSubmit = onSubmit
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 20.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            LinearProgressIndicator(
                progress = { uiState.currentStep.toFloat() / 7f },
                modifier = Modifier.fillMaxWidth().height(4.dp),
                color = YellowPrimary
            )

            when (uiState.currentStep) {
                1 -> IncidentSection(uiState.accident, onUpdate)
                2 -> ClassificationSection(uiState.accident, onUpdate)
                3 -> DamageSection(uiState.accident, onUpdate)
                4 -> GccCaseSection(uiState.accident, onUpdate)
                5 -> InsuranceSection(uiState.accident, onUpdate)
                6 -> RepairSection(uiState.accident, onUpdate)
                7 -> PhotosSection(uiState.accident, onUpdate)
            }
            
            Spacer(Modifier.height(100.dp))
        }
    }
}

@Composable
fun IncidentSection(acc: Accident, onUpdate: ((Accident) -> Accident) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionTitle("Incident Details", Icons.Default.Info)
        OutlinedTextField(
            value = acc.assetNumber,
            onValueChange = { v: String -> onUpdate { it.copy(assetNumber = v) } },
            label = { Text("Asset Number") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(
                value = acc.date,
                onValueChange = { v: String -> onUpdate { it.copy(date = v) } },
                label = { Text("Date") },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp)
            )
            OutlinedTextField(
                value = acc.time ?: "",
                onValueChange = { v: String -> onUpdate { it.copy(time = v) } },
                label = { Text("Time") },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp)
            )
        }
        OutlinedTextField(
            value = acc.location ?: "",
            onValueChange = { v: String -> onUpdate { it.copy(location = v) } },
            label = { Text("Location") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        )
        OutlinedTextField(
            value = acc.description,
            onValueChange = { v: String -> onUpdate { it.copy(description = v) } },
            label = { Text("Description") },
            modifier = Modifier.fillMaxWidth().height(120.dp),
            shape = RoundedCornerShape(12.dp)
        )
    }
}

@Composable
fun ClassificationSection(acc: Accident, onUpdate: ((Accident) -> Accident) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionTitle("Classification", Icons.Default.Category)
        // Stubs for Dropdowns...
        Text("Accident Type: ${acc.accidentType}")
        Text("Severity: ${acc.severity}")
    }
}

@Composable
fun DamageSection(acc: Accident, onUpdate: ((Accident) -> Accident) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionTitle("People & Damage", Icons.Default.MedicalServices)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = acc.injuries, onCheckedChange = { v: Boolean -> onUpdate { it.copy(injuries = v) } })
            Text("Any Injuries?")
        }
        if (acc.injuries) {
            OutlinedTextField(
                value = acc.injuryCount.toString(),
                onValueChange = { v: String -> onUpdate { it.copy(injuryCount = v.toIntOrNull() ?: 0) } },
                label = { Text("Number of Injuries") },
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
fun GccCaseSection(acc: Accident, onUpdate: ((Accident) -> Accident) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionTitle("GCC Case & Liability", Icons.Default.Gavel)
        OutlinedTextField(
            value = acc.najmStatus ?: "",
            onValueChange = { v: String -> onUpdate { it.copy(najmStatus = v) } },
            label = { Text("Najm Status") },
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
fun InsuranceSection(acc: Accident, onUpdate: ((Accident) -> Accident) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionTitle("Insurance & Claim", Icons.Default.AccountBalance)
        OutlinedTextField(
            value = acc.claimAmount?.toString() ?: "",
            onValueChange = { v: String -> onUpdate { it.copy(claimAmount = v.toDoubleOrNull()) } },
            label = { Text("Claim Amount") },
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
fun RepairSection(acc: Accident, onUpdate: ((Accident) -> Accident) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionTitle("Repair & Release", Icons.Default.Build)
        OutlinedTextField(
            value = acc.workshopName ?: "",
            onValueChange = { v: String -> onUpdate { it.copy(workshopName = v) } },
            label = { Text("Workshop Name") },
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
fun PhotosSection(acc: Accident, onUpdate: ((Accident) -> Accident) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionTitle("Evidence & Photos", Icons.Default.CameraAlt)
        Text("Attach at least one photo of the incident.", style = MaterialTheme.typography.bodySmall)
        // Photo Grid Component placeholder
    }
}

@Composable
fun SectionTitle(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = YellowPrimary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(title.uppercase(), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
    }
}

@Composable
fun BottomActionBar(currentStep: Int, isLoading: Boolean, onNext: () -> Unit, onSubmit: () -> Unit) {
    Surface(tonalElevation = 8.dp, modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(20.dp).navigationBarsPadding()) {
            Button(
                onClick = if (currentStep == 7) onSubmit else onNext,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                enabled = !isLoading
            ) {
                if (isLoading) {
                    CircularProgressIndicator(color = Color.Black, modifier = Modifier.size(24.dp))
                } else {
                    Text(if (currentStep == 7) "SUBMIT ACCIDENT REPORT" else "CONTINUE TO STEP ${currentStep + 1}", fontWeight = FontWeight.ExtraBold)
                }
            }
        }
    }
}

@Composable
fun SuccessOverlay(onBack: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color.Green, modifier = Modifier.size(100.dp))
        Spacer(Modifier.height(24.dp))
        Text("Report Submitted", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
        Text("Accident has been queued for sync.", color = MaterialTheme.colorScheme.outline)
        Spacer(Modifier.height(40.dp))
        Button(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text("RETURN TO DASHBOARD")
        }
    }
}
