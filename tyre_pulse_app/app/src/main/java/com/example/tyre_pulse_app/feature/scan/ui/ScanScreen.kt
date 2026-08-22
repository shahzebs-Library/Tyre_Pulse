package com.example.tyre_pulse_app.feature.scan.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.util.Size
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import kotlin.OptIn
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.LifecycleOwner
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.Tyre
import com.example.tyre_pulse_app.feature.scan.data.ScanResolution
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@OptIn(ExperimentalGetImage::class, ExperimentalMaterial3Api::class)
@Composable
fun ScanRoute(
    onBack: () -> Unit,
    onNavigateToInspection: (String, String?) -> Unit, // (assetId, tyreSerial)
    onNavigateToTyreChange: (String, String?) -> Unit, // (assetId, tyrePosition)
    onNavigateToAssetDetail: (String) -> Unit,         // (assetId)
    onNavigateToTyreHistory: (String) -> Unit,         // (tyreId)
    onNavigateToSearch: (String) -> Unit,              // (query)
    viewModel: ScanViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsState()

    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = { granted ->
            hasCameraPermission = granted
        }
    )

    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(key1 = true) {
        if (!hasCameraPermission) {
            launcher.launch(Manifest.permission.CAMERA)
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("QR & Barcode Scanner", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = Color.Black.copy(alpha = 0.6f),
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(Color.Black)
        ) {
            if (hasCameraPermission) {
                CameraScannerView(
                    onBarcodeDetected = { code ->
                        viewModel.resolveBarcode(code)
                    },
                    isScanningEnabled = uiState is ScanUiState.Idle
                )
                
                ScannerOverlay()
            } else {
                PermissionDeniedPlaceholder {
                    launcher.launch(Manifest.permission.CAMERA)
                }
            }

            // Results overlay or bottom sheets
            when (val state = uiState) {
                is ScanUiState.Idle -> {
                    // Just show instructional text
                    Text(
                        text = "Point camera at a tyre or vehicle QR code",
                        color = Color.White.copy(alpha = 0.8f),
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 32.dp)
                            .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(16.dp))
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                is ScanUiState.Resolving -> {
                    ResolvingOverlay()
                }
                is ScanUiState.Success -> {
                    ResolutionResultDialog(
                        resolution = state.resolution,
                        onDismiss = { viewModel.resetState() },
                        onStartInspection = { assetId, tyreSerial ->
                            viewModel.resetState()
                            onNavigateToInspection(assetId, tyreSerial)
                        },
                        onLogTyreChange = { assetId, position ->
                            viewModel.resetState()
                            onNavigateToTyreChange(assetId, position)
                        },
                        onViewAssetDetail = { assetId ->
                            viewModel.resetState()
                            onNavigateToAssetDetail(assetId)
                        },
                        onViewTyreHistory = { tyreId ->
                            viewModel.resetState()
                            onNavigateToTyreHistory(tyreId)
                        },
                        onNavigateToSearch = { query ->
                            viewModel.resetState()
                            onNavigateToSearch(query)
                        }
                    )
                }
                is ScanUiState.Error -> {
                    ErrorOverlay(message = state.message) {
                        viewModel.resetState()
                    }
                }
            }
        }
    }
}

@Composable
fun CameraScannerView(
    onBarcodeDetected: (String) -> Unit,
    isScanningEnabled: Boolean
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }

    DisposableEffect(key1 = true) {
        onDispose {
            cameraExecutor.shutdown()
        }
    }

    AndroidView(
        factory = { ctx ->
            val previewView = PreviewView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                scaleType = PreviewView.ScaleType.FILL_CENTER
            }

            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()
                bindCameraUseCases(
                    cameraProvider,
                    previewView,
                    lifecycleOwner,
                    cameraExecutor,
                    onBarcodeDetected,
                    isScanningEnabled
                )
            }, ContextCompat.getMainExecutor(ctx))

            previewView
        },
        update = { previewView ->
            if (isScanningEnabled) {
                val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()
                    bindCameraUseCases(
                        cameraProvider,
                        previewView,
                        lifecycleOwner,
                        cameraExecutor,
                        onBarcodeDetected,
                        true
                    )
                }, ContextCompat.getMainExecutor(context))
            }
        },
        modifier = Modifier.fillMaxSize()
    )
}

@SuppressLint("UnsafeOptInUsageError")
private fun bindCameraUseCases(
    cameraProvider: ProcessCameraProvider,
    previewView: PreviewView,
    lifecycleOwner: LifecycleOwner,
    cameraExecutor: ExecutorService,
    onBarcodeDetected: (String) -> Unit,
    isScanningEnabled: Boolean
) {
    try {
        cameraProvider.unbindAll()

        if (!isScanningEnabled) return

        val preview = Preview.Builder().build().also {
            it.surfaceProvider = previewView.surfaceProvider
        }

        val barcodeScanner = BarcodeScanning.getClient()
        val imageAnalysis = ImageAnalysis.Builder()
            .setTargetResolution(Size(1280, 720))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()

        imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
            val mediaImage = imageProxy.image
            if (mediaImage != null) {
                val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                barcodeScanner.process(image)
                    .addOnSuccessListener { barcodes ->
                        for (barcode in barcodes) {
                            val rawValue = barcode.rawValue
                            if (!rawValue.isNullOrBlank()) {
                                onBarcodeDetected(rawValue)
                                break
                            }
                        }
                    }
                    .addOnCompleteListener {
                        imageProxy.close()
                    }
            } else {
                imageProxy.close()
            }
        }

        val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
        cameraProvider.bindToLifecycle(
            lifecycleOwner,
            cameraSelector,
            preview,
            imageAnalysis
        )
    } catch (e: Exception) {
        e.printStackTrace()
    }
}

@Composable
fun ScannerOverlay() {
    val infiniteTransition = rememberInfiniteTransition(label = "line")
    val lineOffset by infiniteTransition.animateFloat(
        initialValue = 0.1f,
        targetValue = 0.9f,
        animationSpec = infiniteRepeatable(
            animation = tween(2000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "lineOffset"
    )

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val width = maxWidth
        val height = maxHeight
        val boxSize = width * 0.7f

        Canvas(modifier = Modifier.fillMaxSize()) {
            // Draw semi-transparent background around scanner box
            val paintColor = Color.Black.copy(alpha = 0.6f)
            // Left region
            drawRect(
                color = paintColor,
                topLeft = androidx.compose.ui.geometry.Offset(0f, 0f),
                size = androidx.compose.ui.geometry.Size((width - boxSize).value / 2 * density, height.value * density)
            )
            // Right region
            drawRect(
                color = paintColor,
                topLeft = androidx.compose.ui.geometry.Offset((width + boxSize).value / 2 * density, 0f),
                size = androidx.compose.ui.geometry.Size((width - boxSize).value / 2 * density, height.value * density)
            )
            // Top region
            drawRect(
                color = paintColor,
                topLeft = androidx.compose.ui.geometry.Offset((width - boxSize).value / 2 * density, 0f),
                size = androidx.compose.ui.geometry.Size(boxSize.value * density, (height - boxSize).value / 2 * density)
            )
            // Bottom region
            drawRect(
                color = paintColor,
                topLeft = androidx.compose.ui.geometry.Offset((width - boxSize).value / 2 * density, (height + boxSize).value / 2 * density),
                size = androidx.compose.ui.geometry.Size(boxSize.value * density, (height - boxSize).value / 2 * density)
            )
        }

        // Box frame
        Box(
            modifier = Modifier
                .size(boxSize)
                .align(Alignment.Center)
                .border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp))
        ) {
            // Scanning laser line
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(2.dp)
                    .align(Alignment.TopCenter)
                    .offset(y = boxSize * lineOffset)
                    .background(
                        Brush.horizontalGradient(
                            colors = listOf(
                                Color.Transparent,
                                MaterialTheme.colorScheme.primary,
                                Color.Transparent
                            )
                        )
                    )
            )
        }
    }
}

@Composable
fun ResolvingOverlay() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.7f)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .background(Color.DarkGray.copy(alpha = 0.8f), RoundedCornerShape(16.dp))
                .padding(24.dp)
        ) {
            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.height(16.dp))
            Text("Resolving code...", color = Color.White, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun ErrorOverlay(message: String, onDismiss: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.7f)),
        contentAlignment = Alignment.Center
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
            modifier = Modifier
                .padding(32.dp)
                .fillMaxWidth(),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = "Error",
                    tint = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.size(48.dp)
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Resolution Error",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(24.dp))
                Button(
                    onClick = onDismiss,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.onError
                    )
                ) {
                    Text("Try Again", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResolutionResultDialog(
    resolution: ScanResolution,
    onDismiss: () -> Unit,
    onStartInspection: (String, String?) -> Unit,
    onLogTyreChange: (String, String?) -> Unit,
    onViewAssetDetail: (String) -> Unit,
    onViewTyreHistory: (String) -> Unit,
    onNavigateToSearch: (String) -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(
            modifier = Modifier
                .padding(24.dp)
                .fillMaxWidth()
        ) {
            when (resolution) {
                is ScanResolution.Vehicle -> {
                    VehicleResolutionUI(
                        vehicle = resolution.vehicle,
                        onStartInspection = { onStartInspection(resolution.vehicle.id, null) },
                        onLogTyreChange = { onLogTyreChange(resolution.vehicle.id, null) },
                        onViewDetail = { onViewAssetDetail(resolution.vehicle.id) }
                    )
                }
                is ScanResolution.TyreCode -> {
                    TyreResolutionUI(
                        tyre = resolution.tyre,
                        onStartInspection = {
                            if (resolution.tyre.currentAssetNumber != null) {
                                onStartInspection(resolution.tyre.currentAssetNumber, resolution.tyre.serialNumber)
                            }
                        },
                        onLogTyreChange = {
                            if (resolution.tyre.currentAssetNumber != null) {
                                onLogTyreChange(resolution.tyre.currentAssetNumber, resolution.tyre.position)
                            }
                        },
                        onViewHistory = { onViewTyreHistory(resolution.tyre.id) }
                    )
                }
                is ScanResolution.Unknown -> {
                    UnknownResolutionUI(
                        code = resolution.code,
                        onSearch = { onNavigateToSearch(resolution.code) }
                    )
                }
                ScanResolution.None -> {
                    Text(
                        "No code detected. Please align the scanner window.",
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
            OutlinedButton(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Scan Again")
            }
        }
    }
}

@Composable
fun VehicleResolutionUI(
    vehicle: Asset,
    onStartInspection: () -> Unit,
    onLogTyreChange: () -> Unit,
    onViewDetail: () -> Unit
) {
    Column {
        Text(
            text = "Vehicle Detected",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.secondary,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            text = vehicle.assetNumber,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )
        if (!vehicle.plateNumber.isNullOrBlank()) {
            Text(
                text = "Plate: ${vehicle.plateNumber}",
                style = MaterialTheme.typography.bodyLarge
            )
        }
        Text(
            text = "Type: ${vehicle.type ?: "General"} • Status: ${vehicle.status}",
            style = MaterialTheme.typography.bodyMedium,
            color = Color.Gray
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(
            onClick = onStartInspection,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("Start Asset Inspection")
        }

        Spacer(modifier = Modifier.height(8.dp))

        Button(
            onClick = onLogTyreChange,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary)
        ) {
            Text("Log Tyre Change")
        }

        Spacer(modifier = Modifier.height(8.dp))

        OutlinedButton(
            onClick = onViewDetail,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("View Vehicle Details")
        }
    }
}

@Composable
fun TyreResolutionUI(
    tyre: Tyre,
    onStartInspection: () -> Unit,
    onLogTyreChange: () -> Unit,
    onViewHistory: () -> Unit
) {
    Column {
        Text(
            text = "Tyre Detected",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.secondary,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            text = tyre.serialNumber,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )
        Text(
            text = "Brand: ${tyre.brand} • Size: ${tyre.size ?: "N/A"}",
            style = MaterialTheme.typography.bodyLarge
        )
        if (tyre.currentAssetNumber != null) {
            Text(
                text = "Fitted to: Asset ${tyre.currentAssetNumber} at Position ${tyre.position ?: "N/A"}",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium
            )
        } else {
            Text(
                text = "Status: AVAILABLE (Not Fitted)",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.Gray
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        if (tyre.currentAssetNumber != null) {
            Button(
                onClick = onStartInspection,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("Start Vehicle/Tyre Inspection")
            }

            Spacer(modifier = Modifier.height(8.dp))

            Button(
                onClick = onLogTyreChange,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary)
            ) {
                Text("Log Tyre Change")
            }

            Spacer(modifier = Modifier.height(8.dp))
        }

        OutlinedButton(
            onClick = onViewHistory,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("View Tyre Life & History")
        }
    }
}

@Composable
fun UnknownResolutionUI(
    code: String,
    onSearch: () -> Unit
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(
            imageVector = Icons.Default.QrCodeScanner,
            contentDescription = "Unknown QR",
            tint = Color.Gray,
            modifier = Modifier.size(64.dp)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Unknown QR/Barcode",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Code: \"$code\"",
            style = MaterialTheme.typography.bodyMedium,
            color = Color.Gray,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = "This code doesn't match any vehicles or tyres in our records. Try searching for it manually.",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 16.dp)
        )
        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = onSearch,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("Search Serial Number Manually")
        }
    }
}

@Composable
fun PermissionDeniedPlaceholder(onRequestPermission: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.Warning,
            contentDescription = "No Camera Access",
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(64.dp)
        )
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = "Camera Permission Required",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = Color.White
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "To scan QR codes and barcodes, you must grant camera access to the TyrePulse app.",
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.7f),
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(32.dp))
        Button(
            onClick = onRequestPermission,
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("Grant Camera Access")
        }
    }
}
