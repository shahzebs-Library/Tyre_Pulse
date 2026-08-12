package com.example.tyre_pulse_app.core.common

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.Inspection
import java.io.File
import java.io.FileOutputStream

object PdfGenerator {
    /**
     * Agent 2: High-Fidelity PDF Report Engine.
     * Generates a field-ready document with the visual diagram.
     */
    fun generateInspectionReport(context: Context, asset: Asset, inspection: Inspection): File {
        val pdfDocument = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(595, 842, 1).create()
        val page = pdfDocument.startPage(pageInfo)
        val canvas = page.canvas
        val paint = Paint()

        // Report Header
        paint.color = Color.BLACK
        paint.textSize = 22f
        paint.isFakeBoldText = true
        canvas.drawText("INSPECTION REPORT: ${asset.assetNumber}", 40f, 60f, paint)

        paint.textSize = 12f
        paint.isFakeBoldText = false
        canvas.drawText("Operator: John Technician", 40f, 90f, paint)
        canvas.drawText("Site: Site A", 40f, 110f, paint)

        // Draw Vehicle Map (Native Canvas Port)
        val layout = TyreLayoutEngine.buildLayout(asset.type, asset.assetNumber)
        val scale = 1.5f
        val offsetX = 100f
        val offsetY = 200f

        layout.slots.forEach { slot ->
            val reading = inspection.tyreReadings.find { it.position == slot.id }
            paint.color = if (reading != null) Color.rgb(34, 197, 94) else Color.LTGRAY
            canvas.drawRect(
                offsetX + (slot.x * scale),
                offsetY + (slot.y * scale),
                offsetX + (slot.x + slot.w) * scale,
                offsetY + (slot.y + slot.h) * scale,
                paint
            )
        }

        pdfDocument.finishPage(page)
        val file = File(context.cacheDir, "report_${asset.assetNumber}.pdf")
        pdfDocument.writeTo(FileOutputStream(file))
        pdfDocument.close()
        return file
    }
}
