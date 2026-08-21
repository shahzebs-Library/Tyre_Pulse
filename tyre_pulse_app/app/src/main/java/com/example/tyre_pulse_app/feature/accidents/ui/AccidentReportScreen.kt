package com.example.tyre_pulse_app.feature.accidents.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.MediaStore
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import coil.compose.rememberAsyncImagePainter
import com.google.android.gms.location.LocationServices
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccidentReportScreen(
    onBack: () -> Unit,
    onSubmit: () -> Unit
) {
    val context = LocalContext.current
    var notes by remember { mutableStateOf("") }
    var locationText by remember { mutableStateOf("Fetching location...") }
    var capturedImageUri by remember { mutableStateOf<Uri?>(null) }

    // Location Client
    val fusedLocationClient = remember { LocationServices.getFusedLocationProviderClient(context) }

    // Permissions Launcher
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        ) {
            try {
                fusedLocationClient.lastLocation.addOnSuccessListener { location ->
                    if (location != null) {
                        locationText = "Lat: ${location.latitude}, Lng: ${location.longitude}"
                    } else {
                        locationText = "Location unavailable. Ensure GPS is on."
                    }
                }
            } catch (e: SecurityException) {
                locationText = "Permission denied."
            }
        }
    }

    // Voice Dictation Launcher
    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val spokenText: String? =
                result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.get(0)
            if (spokenText != null) {
                notes = if (notes.isEmpty()) spokenText else "$notes\n$spokenText"
            }
        }
    }

    // Camera Launcher
    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->
        // In a real app we'd save to FileProvider and use TakePicture(), 
        // but for this demo we'll just show the preview or save to cache.
        // To simplify, if we just want to launch the native camera and get a bitmap:
        // (bitmap handling skipped for brevity, assuming success)
    }

    LaunchedEffect(Unit) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            locationPermissionLauncher.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            )
        } else {
            fusedLocationClient.lastLocation.addOnSuccessListener { location ->
                if (location != null) {
                    locationText = "Lat: ${location.latitude}, Lng: ${location.longitude}"
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Report Accident") },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.errorContainer)
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { 
                    Toast.makeText(context, "Accident Report Synced Offline", Toast.LENGTH_SHORT).show()
                    onSubmit()
                },
                icon = { Icon(Icons.Default.Send, contentDescription = "Submit") },
                text = { Text("Submit Report") },
                containerColor = MaterialTheme.colorScheme.error
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            
            // Location Card
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Row(
                    modifier = Modifier.padding(16.dp).fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Icon(Icons.Default.LocationOn, contentDescription = "GPS", tint = MaterialTheme.colorScheme.error)
                    Column {
                        Text("Live GPS Location", style = MaterialTheme.typography.titleMedium)
                        Text(locationText, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            Text("Incident Details", style = MaterialTheme.typography.titleMedium)

            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(150.dp),
                placeholder = { Text("Describe the accident or damage...") },
                trailingIcon = {
                    IconButton(onClick = {
                        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                            putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to dictate report...")
                        }
                        speechLauncher.launch(intent)
                    }) {
                        Icon(Icons.Default.Mic, contentDescription = "Dictate", tint = MaterialTheme.colorScheme.primary)
                    }
                }
            )
            
            Text("Evidence", style = MaterialTheme.typography.titleMedium)
            
            Button(
                onClick = { cameraLauncher.launch(null) },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.CameraAlt, contentDescription = "Camera")
                Spacer(Modifier.width(8.dp))
                Text("Capture Offline Photo")
            }
            
            Spacer(Modifier.height(80.dp))
        }
    }
}
