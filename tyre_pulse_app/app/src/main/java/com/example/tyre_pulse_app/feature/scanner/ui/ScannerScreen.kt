package com.example.tyre_pulse_app.feature.scanner.ui

import android.Manifest
import android.content.pm.PackageManager
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import android.app.Activity
import com.example.tyre_pulse_app.feature.scanner.domain.ScannerEngine
import com.example.tyre_pulse_app.feature.scanner.domain.ScanResult
import com.example.tyre_pulse_app.feature.scanner.domain.NfcReader
import java.util.concurrent.Executors

@Composable
fun ScannerScreen(
    onScanSuccess: (String) -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val haptic = LocalHapticFeedback.current
    val activity = context as? Activity

    val nfcReader = remember(activity) {
        activity?.let { NfcReader(it) }
    }

    DisposableEffect(nfcReader) {
        nfcReader?.enable()
        onDispose {
            nfcReader?.disable()
        }
    }

    LaunchedEffect(nfcReader) {
        nfcReader?.nfcEvents?.collect { tagId ->
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onScanSuccess("RFID:$tagId")
        }
    }

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

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    if (hasCameraPermission) {
        Box(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    val previewView = PreviewView(ctx).apply {
                        this.scaleType = PreviewView.ScaleType.FILL_CENTER
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    }

                    val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                    cameraProviderFuture.addListener({
                        val cameraProvider = cameraProviderFuture.get()

                        val preview = Preview.Builder().build().also {
                            it.setSurfaceProvider(previewView.surfaceProvider)
                        }

                        val scannerEngine = ScannerEngine { result ->
                            when (result) {
                                is ScanResult.BarcodeFound -> {
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onScanSuccess("QR:${result.value}")
                                }
                                is ScanResult.TextFound -> {
                                    // Basic validation: Assume tyre serials are alphanumeric, at least 5 chars
                                    val text = result.text.replace("\\s".toRegex(), "")
                                    if (text.length >= 5 && text.all { it.isLetterOrDigit() }) {
                                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                        onScanSuccess("OCR:${text}")
                                    }
                                }
                            }
                        }
                        val imageAnalyzer = ImageAnalysis.Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                            .also {
                                it.setAnalyzer(
                                    Executors.newSingleThreadExecutor(),
                                    scannerEngine
                                )
                            }

                        val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

                        try {
                            cameraProvider.unbindAll()
                            cameraProvider.bindToLifecycle(
                                lifecycleOwner,
                                cameraSelector,
                                preview,
                                imageAnalyzer
                            )
                        } catch (exc: Exception) {
                            // Handle exceptions
                        }
                    }, ContextCompat.getMainExecutor(ctx))

                    previewView
                }
            )

            // Viewfinder Overlay
            Canvas(modifier = Modifier.fillMaxSize()) {
                val cw = size.width
                val ch = size.height
                
                // Draw semi-transparent background
                drawRect(color = Color.Black.copy(alpha = 0.5f))
                
                val boxWidth = cw * 0.75f
                val boxHeight = cw * 0.75f
                val boxLeft = (cw - boxWidth) / 2
                val boxTop = (ch - boxHeight) / 2
                
                // Clear the center box
                drawRoundRect(
                    color = Color.Transparent,
                    topLeft = Offset(boxLeft, boxTop),
                    size = Size(boxWidth, boxHeight),
                    cornerRadius = CornerRadius(16f, 16f),
                    blendMode = androidx.compose.ui.graphics.BlendMode.Clear
                )

                // Draw bounding box stroke
                drawRoundRect(
                    color = Color(0xFF3b82f6),
                    topLeft = Offset(boxLeft, boxTop),
                    size = Size(boxWidth, boxHeight),
                    cornerRadius = CornerRadius(16f, 16f),
                    style = Stroke(width = 8f)
                )
            }

            Text(
                text = "Point at Tyre RFID / QR Code / Serial\nor TAP phone against RFID tag",
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 64.dp)
                    .background(Color.Black.copy(alpha = 0.7f), shape = MaterialTheme.shapes.medium)
                    .padding(16.dp)
            )

            Button(
                onClick = onBack,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(16.dp)
            ) {
                Text("Back")
            }
        }
    } else {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Camera permission is required to scan tyres.")
            Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                Text("Grant Permission")
            }
        }
    }
}
