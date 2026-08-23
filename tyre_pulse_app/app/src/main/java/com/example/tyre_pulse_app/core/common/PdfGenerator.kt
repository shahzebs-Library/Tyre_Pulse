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

/**
 * Inspection report as a PDF.
 *
 * WHAT WAS WRONG. The header printed `Operator: John Technician` and `Site: Site A`
 * as string literals, on every report, for every asset. Both of those facts were
 * already sitting on the objects passed in - `inspection.inspector` and
 * `inspection.site` - so the invented names were not even filling a gap. A PDF is
 * the artefact that leaves the app: it gets mailed, filed and produced as evidence,
 * so a fabricated operator name on it is the most durable kind of wrong.
 *
 * The wheel map had a related problem: it filled a slot green when a reading existed
 * and grey when none did, with nothing on the page saying so, which invites the
 * reader to take grey as "condition bad" rather than "nobody recorded this". It now
 * carries a legend.
 *
 * NOT CURRENTLY CALLED. Nothing invokes this yet; it is kept because inspection
 * export is a real capability the app is expected to grow, and it is recorded as
 * unwired in docs/NEXT_WORK.md rather than left to look finished.
 */
object PdfGenerator {

    /** Printed wherever a fact genuinely was not captured. Never a plausible stand-in. */
    private const val NOT_RECORDED = "Not recorded"

    fun generateInspectionReport(context: Context, asset: Asset, inspection: Inspection): File {
        val pdfDocument = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, 1).create()
        val page = pdfDocument.startPage(pageInfo)
        val canvas = page.canvas
        val paint = Paint()

        paint.color = Color.BLACK
        paint.textSize = 22f
        paint.isFakeBoldText = true
        canvas.drawText("INSPECTION REPORT: ${asset.assetNumber}", MARGIN, 60f, paint)

        paint.textSize = 12f
        paint.isFakeBoldText = false

        // Every line below reads from the record. A blank field prints "Not recorded",
        // which is a statement about our data - unlike a name, which is a statement
        // about a person.
        val operator = inspection.inspector?.takeIf { it.isNotBlank() } ?: NOT_RECORDED
        val site = inspection.site?.takeIf { it.isNotBlank() }
            ?: asset.site?.takeIf { it.isNotBlank() }
            ?: NOT_RECORDED
        val date = inspection.completedDate?.takeIf { it.isNotBlank() }
            ?: inspection.scheduledDate.takeIf { it.isNotBlank() }
            ?: NOT_RECORDED

        canvas.drawText("Operator: $operator", MARGIN, 90f, paint)
        canvas.drawText("Site: $site", MARGIN, 110f, paint)
        canvas.drawText("Date: $date", MARGIN, 130f, paint)
        canvas.drawText("Status: ${inspection.status}", MARGIN, 150f, paint)

        drawWheelMap(canvas, paint, asset, inspection)

        pdfDocument.finishPage(page)

        val file = File(context.cacheDir, "report_${asset.assetNumber}.pdf")
        // use{} matters: the original left this stream open, so on some devices the
        // last buffer never reached disk and the shared file was silently truncated.
        FileOutputStream(file).use { pdfDocument.writeTo(it) }
        pdfDocument.close()
        return file
    }

    private fun drawWheelMap(canvas: Canvas, paint: Paint, asset: Asset, inspection: Inspection) {
        val layout = TyreLayoutEngine.buildLayout(asset.type, asset.assetNumber)

        paint.color = Color.BLACK
        paint.textSize = 12f
        paint.isFakeBoldText = true
        canvas.drawText("Wheel positions", MARGIN, MAP_TOP - 20f, paint)
        paint.isFakeBoldText = false

        layout.slots.forEach { slot ->
            val recorded = inspection.tyreReadings.any { it.position == slot.id }
            paint.color = if (recorded) RECORDED_GREEN else NOT_RECORDED_GREY
            canvas.drawRect(
                MAP_LEFT + (slot.x * MAP_SCALE),
                MAP_TOP + (slot.y * MAP_SCALE),
                MAP_LEFT + (slot.x + slot.w) * MAP_SCALE,
                MAP_TOP + (slot.y + slot.h) * MAP_SCALE,
                paint
            )
        }

        // The legend is the honest half of the map. Filled means a reading exists,
        // NOT that the tyre is healthy - the app does not measure tyre condition, so
        // the map must not imply a verdict it cannot support.
        val legendY = MAP_TOP + (layout.slots.maxOfOrNull { it.y + it.h }?.times(MAP_SCALE) ?: 0f) + 40f
        paint.textSize = 10f

        paint.color = RECORDED_GREEN
        canvas.drawRect(MARGIN, legendY - 9f, MARGIN + 12f, legendY + 1f, paint)
        paint.color = Color.BLACK
        canvas.drawText("Reading recorded", MARGIN + 20f, legendY, paint)

        paint.color = NOT_RECORDED_GREY
        canvas.drawRect(MARGIN + 140f, legendY - 9f, MARGIN + 152f, legendY + 1f, paint)
        paint.color = Color.BLACK
        canvas.drawText("No reading recorded", MARGIN + 160f, legendY, paint)

        canvas.drawText(
            "Shading shows whether a reading was taken, not tyre condition.",
            MARGIN,
            legendY + 20f,
            paint
        )
    }

    // A4 at 72dpi.
    private const val PAGE_WIDTH = 595
    private const val PAGE_HEIGHT = 842
    private const val MARGIN = 40f
    private const val MAP_LEFT = 100f
    private const val MAP_TOP = 220f
    private const val MAP_SCALE = 1.5f
    private val RECORDED_GREEN = Color.rgb(34, 197, 94)
    private val NOT_RECORDED_GREY = Color.LTGRAY
}
