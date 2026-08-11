package com.example.tyre_pulse_app.feature.rca.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RcaRoute(
    onBack: () -> Unit,
    viewModel: RcaViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Root Cause Analysis", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Psychology, contentDescription = null, tint = YellowPrimary, modifier = Modifier.size(32.dp))
                    Spacer(Modifier.width(12.dp))
                    Text("Investigate the root cause of the defect", style = MaterialTheme.typography.titleMedium)
                }
            }

            item {
                Text("Primary Category", fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                uiState.rootCauses.forEach { cause ->
                    val isSelected = uiState.selectedCause == cause
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .clickable { viewModel.onCauseSelected(cause) },
                        color = if (isSelected) YellowPrimary.copy(alpha = 0.1f) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
                        shape = RoundedCornerShape(8.dp),
                        border = if (isSelected) androidx.compose.foundation.BorderStroke(1.dp, YellowPrimary) else null
                    ) {
                        Text(cause, modifier = Modifier.padding(16.dp), fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal)
                    }
                }
            }

            item {
                Text("The 5 Whys (Guided)", fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                listOf(uiState.why1, uiState.why2, uiState.why3, uiState.why4, uiState.why5).forEachIndexed { i, text ->
                    OutlinedTextField(
                        value = text,
                        onValueChange = { viewModel.onWhyChanged(i + 1, it) },
                        label = { Text("Why ${i + 1}?") },
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        placeholder = { Text("Identify the cause leading to this...") }
                    )
                }
            }

            item {
                Button(
                    onClick = { /* TODO */ },
                    modifier = Modifier.fillMaxWidth().height(56.dp).padding(vertical = 8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Submit Investigation", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
