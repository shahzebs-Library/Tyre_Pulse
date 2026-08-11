package com.example.tyre_pulse_app.core.common

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import java.io.File
import java.io.FileOutputStream

/**
 * Agent 46: Native PDF Generation with Vector Support.
 * Generates an inspection report including the vehicle tyre map.
 */
import com.example.tyre_pulse_app.core.common.TyreLayoutEngine
import com.example.tyre_pulse_app.core.model.Inspection

class PdfGenerator(private val context: Context) {

    fun generateInspectionReport(assetNo: String, type: String?, positions: List<String>, inspection: Inspection): File {
        val document = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(595, 842, 1).create()
        val page = document.startPage(pageInfo)
        val canvas = page.canvas
        val paint = Paint()

        // 1. Header
        paint.color = Color.BLACK
        paint.textSize = 20f
        paint.isFakeBoldText = true
        canvas.drawText("TYRE PULSE - INSPECTION REPORT", 40f, 60f, paint)
        
        paint.textSize = 14f
        paint.isFakeBoldText = false
        canvas.drawText("Asset Number: $assetNo", 40f, 100f, paint)
        canvas.drawText("Vehicle Type: ${type ?: "N/A"}", 40f, 120f, paint)

        // 2. Draw Vector Vehicle Diagram (Agent 48)
        val layout = TyreLayoutEngine.buildLayout(type, positions)
        val drawScale = 1.5f
        val offsetX = 150f
        val offsetY = 200f

        // Draw Chassis
        paint.color = Color.LTGRAY
        canvas.drawRect(
            offsetX + (80 * drawScale),
            offsetY + (layout.chassisTop * drawScale),
            offsetX + (120 * drawScale),
            offsetY + (layout.chassisBot * drawScale),
            paint
        )

        // Draw Tyres based on real positions
        layout.slots.forEach { slot ->
            val reading = inspection.tyreReadings.find { it.position == slot.id }
            paint.color = if (reading != null) Color.BLACK else Color.GRAY
            canvas.drawRect(
                offsetX + (slot.x * drawScale),
                offsetY + (slot.y * drawScale),
                offsetX + ((slot.x + slot.w) * drawScale),
                offsetY + ((slot.y + slot.h) * drawScale),
                paint
            )
            paint.color = Color.WHITE
            paint.textSize = 8f
            canvas.drawText(slot.label, offsetX + (slot.x * drawScale) + 2, offsetY + (slot.y * drawScale) + 10, paint)
        }

        document.finishPage(page)
        val file = File(context.cacheDir, "Inspection_$assetNo.pdf")
        document.writeTo(FileOutputStream(file))
        document.close()
        return file
    }
}
