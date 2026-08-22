package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.model.Accident
import com.example.tyre_pulse_app.core.model.AccidentStatus
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportAccidentScreen(
    onNavigateBack: () -> Unit,
    viewModel: AccidentsViewModel = hiltViewModel()
) {
    var assetNo by remember { mutableStateOf("") }
    var assetNoError by remember { mutableStateOf(false) }
    var description by remember { mutableStateOf("") }
    var descriptionError by remember { mutableStateOf(false) }
    var accidentType by remember { mutableStateOf("collision") }
    
    val accidentTypes = listOf("collision", "glass", "body", "mechanical", "other")
    var accidentTypeExpanded by remember { mutableStateOf(false) }

    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var isSubmitting by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Report Accident") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            OutlinedTextField(
                value = assetNo,
                onValueChange = { 
                    assetNo = it 
                    assetNoError = false
                },
                label = { Text("Asset Number *") },
                modifier = Modifier.fillMaxWidth(),
                isError = assetNoError,
                supportingText = if (assetNoError) { { Text("Asset Number is required") } } else null
            )

            ExposedDropdownMenuBox(
                expanded = accidentTypeExpanded,
                onExpandedChange = { accidentTypeExpanded = !accidentTypeExpanded },
            ) {
                OutlinedTextField(
                    modifier = Modifier.menuAnchor().fillMaxWidth(),
                    readOnly = true,
                    value = accidentType,
                    onValueChange = { },
                    label = { Text("Accident Type") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = accidentTypeExpanded) },
                    colors = ExposedDropdownMenuDefaults.outlinedTextFieldColors(),
                )
                ExposedDropdownMenu(
                    expanded = accidentTypeExpanded,
                    onDismissRequest = { accidentTypeExpanded = false },
                ) {
                    accidentTypes.forEach { selectionOption ->
                        DropdownMenuItem(
                            text = { Text(selectionOption) },
                            onClick = {
                                accidentType = selectionOption
                                accidentTypeExpanded = false
                            },
                            contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                        )
                    }
                }
            }

            OutlinedTextField(
                value = description,
                onValueChange = { 
                    description = it
                    descriptionError = false
                },
                label = { Text("Description *") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 4,
                isError = descriptionError,
                supportingText = if (descriptionError) { { Text("Description is required") } } else null
            )

            Button(
                onClick = {
                    val isAssetNoBlank = assetNo.isBlank()
                    val isDescriptionBlank = description.isBlank()
                    if (isAssetNoBlank || isDescriptionBlank) {
                        assetNoError = isAssetNoBlank
                        descriptionError = isDescriptionBlank
                        scope.launch { snackbarHostState.showSnackbar("Please correct the errors in the form") }
                        return@Button
                    }
                    isSubmitting = true
                    val today = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
                    val record = Accident(
                        assetNumber = assetNo,
                        date = today,
                        accidentType = accidentType.ifBlank { "collision" },
                        description = description,
                        status = AccidentStatus.REPORTED
                    )
                    viewModel.reportAccident(
                        record = record,
                        onSuccess = {
                            isSubmitting = false
                            onNavigateBack()
                        },
                        onError = { error ->
                            isSubmitting = false
                            scope.launch { snackbarHostState.showSnackbar(error) }
                        }
                    )
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !isSubmitting
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp), color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Text("Submit Report")
                }
            }
        }
    }
}
