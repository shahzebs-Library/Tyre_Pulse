package com.example.tyre_pulse_app.core.common

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.io.FileOutputStream
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ImageCompressor @Inject constructor() {
    
    fun compressImage(context: Context, originalFile: File): File {
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = false
            inSampleSize = 2 // Simple downsampling
        }
        
        val bitmap = BitmapFactory.decodeFile(originalFile.absolutePath, options)
        val compressedFile = File(context.cacheDir, "comp_${originalFile.name}")
        
        FileOutputStream(compressedFile).use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 70, out)
        }
        
        return compressedFile
    }
}
