package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.designsystem.component.GlassCard
import com.example.tyre_pulse_app.core.designsystem.component.GradientButton
import com.example.tyre_pulse_app.core.designsystem.component.StatusChip
import com.example.tyre_pulse_app.core.designsystem.theme.*
import com.example.tyre_pulse_app.core.model.WorkOrderType
import com.example.tyre_pulse_app.core.model.TaskPriority

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateWorkOrderScreen(
    onBack: () -> Unit,
    onCreated: () -> Unit = {}
) {
    // Form state
    var assetNumber by remember { mutableStateOf("") }
    var reportedIssue by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf(WorkOrderType.BREAKDOWN) }
    var selectedPriority by remember { mutableStateOf(TaskPriority.MEDIUM) }
    var assignedTechnician by remember { mutableStateOf("") }
    var dueDate by remember { mutableStateOf("") }
    var partsRequired by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var isSubmitted by remember { mutableStateOf(false) }

    // Validation
    val isValid = assetNumber.isNotBlank() && reportedIssue.length >= 10

    if (isSubmitted) {
        LaunchedEffect(Unit) { onCreated(); onBack() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("New Work Order", fontWeight = FontWeight.ExtraBold,
                            style = MaterialTheme.typography.titleLarge)
                        Text("Fill in the details below",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
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
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(16.dp)
                    .navigationBarsPadding()
            ) {
                if (!isValid) {
                    Text(
                        "Asset number and issue description (min 10 chars) required",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }
                GradientButton(
                    text = "Create Work Order",
                    onClick = { isSubmitting = true; isSubmitted = true },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = isValid,
                    loading = isSubmitting
                )
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Asset Details
            GlassCard {
                SectionTitle("ASSET DETAILS", Icons.Default.DirectionsCar, StatusBlue)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = assetNumber,
                    onValueChange = { assetNumber = it },
                    label = { Text("Asset / Vehicle Number *") },
                    placeholder = { Text("e.g. MIX-2841 or scan QR") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Default.QrCodeScanner, null) },
                    trailingIcon = {
                        if (assetNumber.isNotEmpty())
                            IconButton(onClick = { assetNumber = "" }) {
                                Icon(Icons.Default.Clear, null)
                            }
                    }
                )
            }

            // Work Order Type
            GlassCard {
                SectionTitle("ORDER TYPE", Icons.Default.Category, YellowPrimary)
                Spacer(Modifier.height(12.dp))
                val types = listOf(
                    WorkOrderType.BREAKDOWN to ("🔴" to "Breakdown"),
                    WorkOrderType.PM to ("🟡" to "Planned Maintenance"),
                    WorkOrderType.PMD to ("🔵" to "PM Due"),
                    WorkOrderType.INSPECTION_REPAIR to ("🟢" to "Inspection Repair"),
                    WorkOrderType.OTHER to ("⚪" to "Other")
                )
                types.chunked(2).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { (type, pair) ->
                            val (emoji, label) = pair
                            val selected = type == selectedType
                            Surface(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable { selectedType = type }
                                    .border(
                                        1.5.dp,
                                        if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
                                        RoundedCornerShape(12.dp)
                                    ),
                                color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)
                                else MaterialTheme.colorScheme.surface
                            ) {
                                Column(
                                    modifier = Modifier.padding(10.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    Text(emoji, fontSize = 20.sp)
                                    Spacer(Modifier.height(4.dp))
                                    Text(label, style = MaterialTheme.typography.labelSmall,
                                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                        color = if (selected) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.onSurface)
                                }
                            }
                        }
                        // fill last row if odd count
                        if (row.size == 1) Spacer(Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }

            // Priority
            GlassCard {
                SectionTitle("PRIORITY", Icons.Default.Flag, StatusOrange)
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(
                        TaskPriority.LOW to (StatusGreen to "Low"),
                        TaskPriority.MEDIUM to (StatusOrange to "Medium"),
                        TaskPriority.HIGH to (StatusRed to "High"),
                        TaskPriority.CRITICAL to (Color(0xFF7C3AED) to "Critical")
                    ).forEach { (priority, pair) ->
                        val (color, label) = pair
                        val selected = priority == selectedPriority
                        FilterChip(
                            selected = selected,
                            onClick = { selectedPriority = priority },
                            label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                            modifier = Modifier.weight(1f),
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = color,
                                selectedLabelColor = Color.White,
                                selectedLeadingIconColor = Color.White
                            ),
                            leadingIcon = if (selected) {
                                { Icon(Icons.Default.Check, null, modifier = Modifier.size(14.dp)) }
                            } else null
                        )
                    }
                }
            }

            // Reported Issue
            GlassCard {
                SectionTitle("ISSUE DESCRIPTION", Icons.Default.Report, StatusRed)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = reportedIssue,
                    onValueChange = { reportedIssue = it },
                    label = { Text("Reported Issue *") },
                    placeholder = { Text("Describe the fault, noise, symptom...") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp),
                    maxLines = 6,
                    supportingText = {
                        Text("/500 — min 10 characters",
                            color = if (reportedIssue.length < 10 && reportedIssue.isNotEmpty())
                                MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline)
                    }
                )
            }

            // Assignment & Scheduling
            GlassCard {
                SectionTitle("ASSIGNMENT", Icons.Default.Person, MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = assignedTechnician,
                    onValueChange = { assignedTechnician = it },
                    label = { Text("Assign to Technician (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Default.Engineering, null) }
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = dueDate,
                    onValueChange = { dueDate = it },
                    label = { Text("Due Date (optional)") },
                    placeholder = { Text("e.g. 2026-09-01") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Default.CalendarToday, null) }
                )
            }

            // Parts Required
            GlassCard {
                SectionTitle("PARTS / MATERIALS", Icons.Default.Inventory, StatusGreen)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = partsRequired,
                    onValueChange = { partsRequired = it },
                    label = { Text("Parts or materials required (optional)") },
                    placeholder = { Text("e.g. Engine oil filter, 2x belts...") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp),
                    maxLines = 4
                )
            }

            // Summary preview
            AnimatedVisibility(visible = isValid) {
                GlassCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.CheckCircle, null, tint = StatusGreen, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Ready to Submit", fontWeight = FontWeight.Bold, color = StatusGreen,
                            style = MaterialTheme.typography.titleSmall)
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        StatusChip(selectedType.name, MaterialTheme.colorScheme.primary)
                        StatusChip(selectedPriority.name, when(selectedPriority) {
                            TaskPriority.LOW -> StatusGreen
                            TaskPriority.MEDIUM -> StatusOrange
                            TaskPriority.HIGH -> StatusRed
                            TaskPriority.CRITICAL -> Color(0xFF7C3AED)
                        })
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun SectionTitle(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier.size(28.dp).clip(CircleShape).background(color.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center
        ) { Icon(icon, null, tint = color, modifier = Modifier.size(14.dp)) }
        Spacer(Modifier.width(8.dp))
        Text(title, style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp, color = color)
    }
}
