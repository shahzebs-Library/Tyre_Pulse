package com.example.tyre_pulse_app.feature.checklists.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.model.ChecklistField
import com.example.tyre_pulse_app.core.model.ChecklistTemplate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChecklistRunnerRoute(
    onBack: () -> Unit,
    viewModel: ChecklistViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(uiState.template?.name ?: "Checklist", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        if (uiState.isLoading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = androidx.compose.ui.Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            LazyColumn(
                modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                uiState.template?.fields?.let { fields ->
                    items(fields) { field ->
                        DynamicField(
                            field = field,
                            value = uiState.answers[field.id],
                            onValueChange = { viewModel.updateAnswer(field.id, it) }
                        )
                    }
                }
                
                item {
                    Button(
                        onClick = { viewModel.submit() },
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary, contentColor = androidx.compose.ui.graphics.Color.Black)
                    ) {
                        Text("Submit Submission", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
fun DynamicField(
    field: ChecklistField,
    value: Any?,
    onValueChange: (Any) -> Unit
) {
    Column {
        Text(field.label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        if (field.help != null) {
            Text(field.help, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
        Spacer(Modifier.height(8.dp))
        
        when (field.type) {
            "text" -> OutlinedTextField(
                value = value as? String ?: "",
                onValueChange = onValueChange,
                modifier = Modifier.fillMaxWidth()
            )
            "number" -> OutlinedTextField(
                value = value as? String ?: "",
                onValueChange = onValueChange,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
            )
            "boolean" -> Switch(
                checked = value as? Boolean ?: false,
                onCheckedChange = onValueChange
            )
            "select" -> {
                // Simplified select
                field.options?.forEach { option ->
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        RadioButton(selected = value == option, onClick = { onValueChange(option) })
                        Text(option)
                    }
                }
            }
        }
    }
}
