package com.example.tyre_pulse_app.core.designsystem.component

import androidx.compose.ui.geometry.Offset

/**
 * Turn captured signature strokes into a self-contained SVG document.
 *
 * WHY SVG. A signature has to survive the trip to the backend and be renderable
 * again by the web app and by PDF reports. A Compose [androidx.compose.ui.graphics.Path]
 * cannot be serialised, so the drawing has to be captured as points while the finger
 * moves. SVG is what the Expo app already stores for the same field, so both apps
 * write the same shape and one signature renders everywhere.
 *
 * WHAT THIS REPLACED. The checklist runner drew a path on screen and then saved the
 * literal string "signature_data_url_mock_<timestamp>". The operator saw their
 * signature, pressed CONFIRM, and a placeholder was stored. Every signed checklist
 * in the system carried a token instead of a signature - on a record whose whole
 * purpose is to attest that a named person checked something.
 */
object SignatureSvg {

    /** Matches the on-screen stroke so the saved mark looks like what was drawn. */
    private const val STROKE_WIDTH = 6

    /**
     * @param strokes one list of points per finger-down..finger-up gesture
     * @param width   the width of the capture area, in the same units as the points
     * @param height  the height of the capture area
     * @return an SVG document, or null when nothing was actually drawn - a caller
     *         must never store an empty signature as though it were a real one.
     */
    fun fromStrokes(strokes: List<List<Offset>>, width: Int, height: Int): String? {
        val drawn = strokes.filter { it.isNotEmpty() }
        if (drawn.isEmpty()) return null
        if (width <= 0 || height <= 0) return null

        val paths = drawn.joinToString("") { stroke ->
            val d = StringBuilder()
            stroke.forEachIndexed { index, point ->
                d.append(if (index == 0) "M" else "L")
                    .append(fmt(point.x)).append(' ').append(fmt(point.y)).append(' ')
            }
            // A single tap is a dot, not a line: give it a length so it renders.
            if (stroke.size == 1) {
                val p = stroke.first()
                d.append("L").append(fmt(p.x + 0.5f)).append(' ').append(fmt(p.y)).append(' ')
            }
            """<path d="${d.toString().trim()}" fill="none" stroke="#000000" """ +
                """stroke-width="$STROKE_WIDTH" stroke-linecap="round" stroke-linejoin="round"/>"""
        }

        return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 $width $height" """ +
            """width="$width" height="$height">$paths</svg>"""
    }

    /** One decimal place is plenty for a signature and keeps the payload small. */
    private fun fmt(value: Float): String {
        val rounded = Math.round(value * 10f) / 10f
        return if (rounded == rounded.toInt().toFloat()) rounded.toInt().toString() else rounded.toString()
    }
}
