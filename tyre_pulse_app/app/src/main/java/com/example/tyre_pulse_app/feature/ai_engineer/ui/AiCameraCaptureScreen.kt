package com.example.tyre_pulse_app.feature.ai_engineer.ui

import android.content.Context
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Camera
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import java.io.File
import java.util.concurrent.Executor

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiCameraCaptureScreen(
    onImageCaptured: (File) -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraProviderFuture = remember { ProcessCameraProvider.getInstance(context) }
    
    var imageCapture: ImageCapture? by remember { mutableStateOf(null) }

    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
    }

    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(title = { Text("AI Part Wear Analysis") })
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = {
                    val file = File(context.cacheDir, "ai_qc_scan_${System.currentTimeMillis()}.jpg")
                    val outputOptions = ImageCapture.OutputFileOptions.Builder(file).build()
                    imageCapture?.takePicture(
                        outputOptions,
                        ContextCompat.getMainExecutor(context),
                        object : ImageCapture.OnImageSavedCallback {
                            override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                                Log.d("CameraX", "AI Photo capture succeeded: ${file.absolutePath}")
                                onImageCaptured(file)
                            }

                            override fun onError(exc: ImageCaptureException) {
                                Log.e("CameraX", "Photo capture failed: ${exc.message}", exc)
                            }
                        }
                    )
                }
            ) {
                Icon(Icons.Default.Camera, contentDescription = "Capture AI Photo")
            }
        },
        floatingActionButtonPosition = FabPosition.Center
    ) { padding ->
        if (hasCameraPermission) {
            Box(modifier = Modifier.fillMaxSize().padding(padding)) {
                AndroidView(
                    factory = { ctx ->
                        val previewView = PreviewView(ctx)
                        val executor = ContextCompat.getMainExecutor(ctx)
                        
                        cameraProviderFuture.addListener({
                            val cameraProvider = cameraProviderFuture.get()
                            val preview = Preview.Builder().build().also {
                                it.setSurfaceProvider(previewView.surfaceProvider)
                            }
                            
                            imageCapture = ImageCapture.Builder().build()
                            
                            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
                            
                            try {
                                cameraProvider.unbindAll()
                                cameraProvider.bindToLifecycle(
                                    lifecycleOwner,
                                    cameraSelector,
                                    preview,
                                    imageCapture
                                )
                            } catch (exc: Exception) {
                                Log.e("CameraX", "Use case binding failed", exc)
                            }
                        }, executor)
                        
                        previewView
                    },
                    modifier = Modifier.fillMaxSize()
                )
                
                // Overlay for AI guidance
                Box(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(16.dp)
                ) {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface.copy(alpha=0.7f))) {
                        Text(
                            "Align the mechanical part or tyre tread within the frame for AI wear analysis.",
                            modifier = Modifier.padding(16.dp),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            }
        } else {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("Camera permission is required for AI Analysis")
            }
        }
    }
}
