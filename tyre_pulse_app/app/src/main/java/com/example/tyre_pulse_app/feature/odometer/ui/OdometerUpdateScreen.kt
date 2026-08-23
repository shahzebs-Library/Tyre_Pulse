package com.example.tyre_pulse_app.feature.odometer.ui
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import android.graphics.Bitmap
import java.io.ByteArrayOutputStream
import androidx.compose.material.icons.filled.Check

import androidx.compose.material3.pulltorefresh.PullToRefreshBox

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OdometerUpdateScreen(
    // No defaults. Both of these used to be fabricated - vehicleId defaulted to
    // "V-1024" and previousOdometer to 124500 - so any caller that forgot to pass
    // them wrote a meter reading against a vehicle that does not exist and validated
    // it against an invented baseline. A default here is not a convenience, it is a
    // silent data-integrity bug.
    vehicleId: String,
    // Null means the previous reading is genuinely unknown. It is NOT zero, and it is
    // not a guess: with no baseline the monotonic check below is skipped rather than
    // run against a number nobody recorded.
    previousOdometer: Int?,
    isSubmitting: Boolean = false,
    submitError: String? = null,
    onBack: () -> Unit,
    onSubmit: (Int, ByteArray?) -> Unit
) {
    var newOdometerStr by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var photoUri by remember { mutableStateOf<Uri?>(null) }
    var capturedPhoto by remember { mutableStateOf<Bitmap?>(null) }
    
    var isRefreshing by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    if (isRefreshing) {
        LaunchedEffect(true) {
            isRefreshing = false
        }
    }

    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->
        capturedPhoto = bitmap
    }

    val validateAndSubmit = {
        val newOdo = newOdometerStr.toIntOrNull()
        if (newOdo == null) {
            errorMessage = "Please enter a valid number"
        } else if (newOdo < 0) {
            errorMessage = "A meter reading cannot be negative"
        } else if (previousOdometer != null && newOdo <= previousOdometer) {
            // A meter does not run backwards. This check is only meaningful when the
            // previous reading is actually known, which is why it is guarded.
            errorMessage = "New reading must be higher than the last recorded $previousOdometer km"
        } else if (previousOdometer != null && newOdo > previousOdometer + 50000) {
            errorMessage = "That is more than 50,000 km above the last reading. Please double check."
        } else {
            errorMessage = null
            var photoBytes: ByteArray? = null
            capturedPhoto?.let { bmp ->
                val stream = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, 80, stream)
                photoBytes = stream.toByteArray()
            }
            onSubmit(newOdo, photoBytes)
        }
    }

    LaunchedEffect(submitError) {
        submitError?.let {
            snackbarHostState.showSnackbar(it)
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Update Odometer") },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true },
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                
        
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(24.dp)
            ) {
                
                // Vehicle Info Card
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Vehicle ID: $vehicleId", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Last Recorded Odometer:", style = MaterialTheme.typography.bodyMedium)
                        // An unknown baseline says so; it must not render as a number.
                        Text(
                            previousOdometer?.let { "$it km" } ?: "No previous reading recorded",
                            style = MaterialTheme.typography.headlineMedium,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
    
                // Input Field
                OutlinedTextField(
                    value = newOdometerStr,
                    onValueChange = { 
                        newOdometerStr = it
                        errorMessage = null 
                    },
                    label = { Text("New Odometer Reading (km)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    isError = errorMessage != null,
                    supportingText = {
                        if (errorMessage != null) {
                            Text(errorMessage!!, color = MaterialTheme.colorScheme.error)
                        }
                    }
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
    
                // Submit
                Button(
                    onClick = validateAndSubmit,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    enabled = !isSubmitting
                ) {
                    if (isSubmitting) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), color = MaterialTheme.colorScheme.onPrimary)
                    } else {
                        Text("Submit Reading", style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
            
            
        }
    }
}
