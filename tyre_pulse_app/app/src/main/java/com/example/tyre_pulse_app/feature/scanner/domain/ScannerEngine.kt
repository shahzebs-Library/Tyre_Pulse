package com.example.tyre_pulse_app.feature.scanner.domain

import android.media.Image
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

sealed class ScanResult {
    data class BarcodeFound(val value: String) : ScanResult()
    data class TextFound(val text: String) : ScanResult()
}

class ScannerEngine(private val onResult: (ScanResult) -> Unit) : ImageAnalysis.Analyzer {

    private val barcodeScanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39)
            .build()
    )

    private val textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    @OptIn(ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage: Image? = imageProxy.image
        if (mediaImage != null) {
            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
            
            // Run Barcode Scanner
            barcodeScanner.process(image)
                .addOnSuccessListener { barcodes ->
                    for (barcode in barcodes) {
                        barcode.rawValue?.let { 
                            onResult(ScanResult.BarcodeFound(it))
                        }
                    }
                }
                .addOnCompleteListener {
                    // Run Text Recognizer (OCR) as fallback
                    textRecognizer.process(image)
                        .addOnSuccessListener { visionText ->
                            for (block in visionText.textBlocks) {
                                onResult(ScanResult.TextFound(block.text))
                            }
                        }
                        .addOnCompleteListener {
                            imageProxy.close() // ALWAYS CLOSE
                        }
                }
        } else {
            imageProxy.close()
        }
    }
}
