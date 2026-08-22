package com.example.tyre_pulse_app.feature.washing.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.model.WashRecord
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.ui.text.font.FontWeight
import android.graphics.Bitmap
import java.io.ByteArrayOutputStream

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogWashScreen(
    onNavigateBack: () -> Unit,
    viewModel: WashingViewModel = hiltViewModel()
) {
    var assetNo by remember { mutableStateOf("") }
    var assetNoError by remember { mutableStateOf(false) }
    var washType by remember { mutableStateOf("Full") }
    var notes by remember { mutableStateOf("") }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var isSubmitting by remember { mutableStateOf(false) }
    
    val washTypes = listOf("Full", "Exterior", "Interior", "Quick")
    var washTypeExpanded by remember { mutableStateOf(false) }

    var capturedPhoto by remember { mutableStateOf<Bitmap?>(null) }

    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->
        capturedPhoto = bitmap
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Log a Wash") },
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
                expanded = washTypeExpanded,
                onExpandedChange = { washTypeExpanded = !washTypeExpanded },
            ) {
                OutlinedTextField(
                    modifier = Modifier.menuAnchor().fillMaxWidth(),
                    readOnly = true,
                    value = washType,
                    onValueChange = { },
                    label = { Text("Wash Type") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = washTypeExpanded) },
                    colors = ExposedDropdownMenuDefaults.outlinedTextFieldColors(),
                )
                ExposedDropdownMenu(
                    expanded = washTypeExpanded,
                    onDismissRequest = { washTypeExpanded = false },
                ) {
                    washTypes.forEach { selectionOption ->
                        DropdownMenuItem(
                            text = { Text(selectionOption) },
                            onClick = {
                                washType = selectionOption
                                washTypeExpanded = false
                            },
                            contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                        )
                    }
                }
            }

            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text("Notes (Optional)") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3
            )
            
            // Optional Evidence
            Button(
                onClick = { cameraLauncher.launch(null) },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (capturedPhoto != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary
                )
            ) {
                if (capturedPhoto != null) {
                    Icon(Icons.Default.Check, contentDescription = "Photo Captured")
                    Spacer(Modifier.width(8.dp))
                    Text("Photo Captured")
                } else {
                    Icon(Icons.Default.CameraAlt, contentDescription = "Camera")
                    Spacer(Modifier.width(8.dp))
                    Text("Take Photo Proof (Optional)")
                }
            }
            
            Spacer(Modifier.weight(1f))

            Button(
                onClick = {
                    if (assetNo.isBlank()) {
                        assetNoError = true
                        scope.launch { snackbarHostState.showSnackbar("Please correct the errors in the form") }
                        return@Button
                    }
                    isSubmitting = true
                    val today = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
                    val record = WashRecord(
                        assetNumber = assetNo,
                        washDate = today,
                        washType = washType.ifBlank { "Full" },
                        notes = notes.takeIf { it.isNotBlank() }
                    )
                    
                    var photoBytes: ByteArray? = null
                    capturedPhoto?.let { bmp ->
                        val stream = ByteArrayOutputStream()
                        bmp.compress(Bitmap.CompressFormat.JPEG, 80, stream)
                        photoBytes = stream.toByteArray()
                    }
                    
                    viewModel.logWash(
                        record = record,
                        photoBytes = photoBytes,
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
                modifier = Modifier.fillMaxWidth().height(56.dp),
                enabled = !isSubmitting
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp), color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Text("Submit", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
