package com.example.tyre_pulse_app.feature.inspections.component

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.core.graphics.PathParser

object VehicleTyreDrawings {

    fun DrawScope.drawTyre(
        x: Float, y: Float, w: Float, h: Float, 
        label: String,
        risk: String, // "good", "warning", "critical", "none"
        isSelected: Boolean,
        isRecorded: Boolean,
        isOutstanding: Boolean,
        scale: Float
    ) {
        val cx = x + w / 2
        val cy = y + h / 2

        // Risk colors
        val rimColor = when (risk) {
            "good" -> Color(0xFF94a3b8)
            "warning" -> Color(0xFFfbbf24)
            "critical" -> Color(0xFFef4444)
            else -> Color(0xFF94a3b8)
        }
        val rimGlow = when (risk) {
            "good" -> Color(0xFFcbd5e1)
            "warning" -> Color(0xFFfde68a)
            "critical" -> Color(0xFFfca5a5)
            else -> Color(0xFFcbd5e1)
        }
        val rimDark = when (risk) {
            "good" -> Color(0xFF475569)
            "warning" -> Color(0xFFb45309)
            "critical" -> Color(0xFF991b1b)
            else -> Color(0xFF475569)
        }

        val rubberGradient = Brush.radialGradient(
            colors = listOf(Color(0xFF454545), Color(0xFF161616), Color(0xFF050505)),
            center = Offset(x + w * 0.33f, y + h * 0.24f),
            radius = w * 0.82f
        )
        val rimGradient = Brush.radialGradient(
            colors = listOf(rimColor, rimGlow, rimDark),
            center = Offset(cx - w * 0.17f, cy - h * 0.24f),
            radius = w * 0.80f
        )
        val hubGradient = Brush.radialGradient(
            colors = listOf(Color(0xFFeef2f6), Color(0xFF94a3b8), Color(0xFF28313d)),
            center = Offset(cx - w * 0.18f, cy - h * 0.22f),
            radius = w * 0.76f
        )

        // Ground shadow
        drawOval(
            color = Color(0x66020617),
            topLeft = Offset(x - 1.6f * scale, y + 2.4f * scale),
            size = Size(w + 3.2f * scale, h + 2.4f * scale)
        )

        // Rubber body
        drawRoundRect(
            brush = rubberGradient,
            topLeft = Offset(x, y),
            size = Size(w, h),
            cornerRadius = CornerRadius(w * 0.3f, w * 0.3f)
        )
        drawRoundRect(
            color = Color.Black,
            topLeft = Offset(x, y),
            size = Size(w, h),
            cornerRadius = CornerRadius(w * 0.3f, w * 0.3f),
            style = Stroke(width = 0.7f * scale)
        )

        // Deep directional tread (split blocks)
        val treadRows = listOf(0, 1, 2, 3, 4, 5, 6)
        treadRows.forEach { i ->
            val gy = y + h * (0.08f + i * 0.128f)
            val bw = (w - 2 * scale) * 0.44f
            drawRoundRect(
                color = Color.Black.copy(alpha = 0.6f),
                topLeft = Offset(x + 1 * scale, gy),
                size = Size(bw, h * 0.07f),
                cornerRadius = CornerRadius(0.8f * scale, 0.8f * scale)
            )
            drawRoundRect(
                color = Color.Black.copy(alpha = 0.6f),
                topLeft = Offset(x + 1 * scale + (w - 2 * scale) * 0.52f, gy),
                size = Size(bw, h * 0.07f),
                cornerRadius = CornerRadius(0.8f * scale, 0.8f * scale)
            )
        }

        // Sidewall ring + top light
        drawRoundRect(
            color = Color(0xFF5b6470).copy(alpha = 0.55f),
            topLeft = Offset(x + 0.7f * scale, y + 0.7f * scale),
            size = Size(w - 1.4f * scale, h - 1.4f * scale),
            cornerRadius = CornerRadius(w * 0.27f, w * 0.27f),
            style = Stroke(width = 0.6f * scale)
        )
        drawRoundRect(
            color = Color.White.copy(alpha = 0.09f),
            topLeft = Offset(x + 1 * scale, y + 1 * scale),
            size = Size(w - 2 * scale, h * 0.3f),
            cornerRadius = CornerRadius(w * 0.24f, w * 0.24f)
        )

        // Rim disc
        drawOval(
            brush = rimGradient,
            topLeft = Offset(cx - w * 0.37f, cy - h * 0.35f),
            size = Size(w * 0.74f, h * 0.70f)
        )
        drawOval(
            color = rimDark,
            topLeft = Offset(cx - w * 0.37f, cy - h * 0.35f),
            size = Size(w * 0.74f, h * 0.70f),
            style = Stroke(width = 0.7f * scale)
        )

        // Lug nuts
        val lugRadius = maxOf(0.7f * scale, w * 0.035f)
        for (k in 0..7) {
            val a = (k * Math.PI) / 4
            val lx = cx + Math.cos(a).toFloat() * w * 0.2f
            val ly = cy + Math.sin(a).toFloat() * h * 0.19f
            drawCircle(
                color = rimDark.copy(alpha = 0.9f),
                radius = lugRadius,
                center = Offset(lx, ly)
            )
        }

        // Hub cap + shine
        drawOval(
            brush = hubGradient,
            topLeft = Offset(cx - w * 0.13f, cy - h * 0.13f),
            size = Size(w * 0.26f, h * 0.26f)
        )
        drawOval(
            color = Color(0xFF1f2937),
            topLeft = Offset(cx - w * 0.13f, cy - h * 0.13f),
            size = Size(w * 0.26f, h * 0.26f),
            style = Stroke(width = 0.4f * scale)
        )
        drawOval(
            color = Color(0xFFf8fafc).copy(alpha = 0.85f),
            topLeft = Offset(cx - w * 0.035f - w * 0.045f, cy - h * 0.035f - h * 0.045f),
            size = Size(w * 0.09f, h * 0.09f)
        )

        // Outstanding indicator
        if (isOutstanding && !isSelected) {
            drawRoundRect(
                color = Color(0xFFe2e8f0).copy(alpha = 0.95f),
                topLeft = Offset(x - 2.5f * scale, y - 2.5f * scale),
                size = Size(w + 5 * scale, h + 5 * scale),
                cornerRadius = CornerRadius(w * 0.3f + 1 * scale, w * 0.3f + 1 * scale),
                style = Stroke(
                    width = 1.2f * scale,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.6f * scale, 2f * scale))
                )
            )
        }

        // Selected indicator
        if (isSelected) {
            drawRoundRect(
                color = Color(0xFF3b82f6),
                topLeft = Offset(x - 3f * scale, y - 3f * scale),
                size = Size(w + 6 * scale, h + 6 * scale),
                cornerRadius = CornerRadius(w * 0.3f + 1 * scale, w * 0.3f + 1 * scale),
                style = Stroke(width = 2.5f * scale)
            )
        }

        // Recorded indicator
        if (isRecorded && !isSelected) {
            drawCircle(
                color = Color(0xFF16a34a),
                radius = maxOf(2.5f * scale, w * 0.16f),
                center = Offset(x + w, y)
            )
            drawCircle(
                color = Color.White,
                radius = maxOf(2.5f * scale, w * 0.16f),
                center = Offset(x + w, y),
                style = Stroke(width = 0.5f * scale)
            )
        }
    }

    fun DrawScope.drawPickupBody(scale: Float) {
        // Ground shadow
        drawOval(
            color = Color(0x4D000000), // rgba(0,0,0,0.3)
            topLeft = Offset(22f * scale, 295f * scale),
            size = Size(156f * scale, 20f * scale)
        )

        // Cab roof
        val roofPathStr = "M 72,22 Q 60,22 58,36 L 56,70 L 56,275 Q 56,286 72,288 L 128,288 Q 144,286 144,275 L 144,70 L 142,36 Q 140,22 128,22 Z"
        val roofPath = PathParser.createPathFromPathData(roofPathStr).asComposePath()
        roofPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        
        drawPath(
            path = roofPath,
            brush = Brush.radialGradient(
                colors = listOf(Color(0xFF93c5fd), Color(0xFF3b82f6), Color(0xFF1d4ed8), Color(0xFF1e3a8a)),
                center = Offset(96f * scale, 120f * scale),
                radius = 120f * scale
            )
        )

        // Hood
        drawRoundRect(
            brush = Brush.linearGradient(
                colors = listOf(Color(0xFF1e3a8a), Color(0xFF2563eb), Color(0xFF60a5fa), Color(0xFF2563eb), Color(0xFF1e3a8a)),
                start = Offset(60f * scale, 22f * scale),
                end = Offset(140f * scale, 22f * scale)
            ),
            topLeft = Offset(60f * scale, 22f * scale),
            size = Size(80f * scale, 52f * scale),
            cornerRadius = CornerRadius(5f * scale, 5f * scale)
        )

        // Windshield
        val wsPathStr = "M 65,74 L 135,74 L 131,96 L 69,96 Z"
        val wsPath = PathParser.createPathFromPathData(wsPathStr).asComposePath()
        wsPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(
            path = wsPath,
            brush = Brush.linearGradient(
                colors = listOf(Color(0xF2dbeafe), Color(0xD993c5fd), Color(0x993b82f6)),
                start = Offset(65f * scale, 74f * scale),
                end = Offset(135f * scale, 96f * scale)
            )
        )

        // Cab Roof
        drawRoundRect(
            brush = Brush.radialGradient(
                colors = listOf(Color(0xFF3b82f6), Color(0xFF1e3a8a)),
                center = Offset(100f * scale, 128f * scale),
                radius = 64f * scale
            ),
            topLeft = Offset(60f * scale, 96f * scale),
            size = Size(80f * scale, 64f * scale),
            cornerRadius = CornerRadius(3f * scale, 3f * scale)
        )

        // Rear window
        val rwPathStr = "M 68,158 L 132,158 L 130,169 L 70,169 Z"
        val rwPath = PathParser.createPathFromPathData(rwPathStr).asComposePath()
        rwPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(
            path = rwPath,
            brush = Brush.linearGradient(
                colors = listOf(Color(0xF2dbeafe), Color(0xD993c5fd), Color(0x993b82f6)),
                start = Offset(68f * scale, 158f * scale),
                end = Offset(132f * scale, 169f * scale)
            )
        )

        // Pickup bed
        drawRoundRect(
            brush = Brush.linearGradient(
                colors = listOf(Color(0xFF1e3a8a), Color(0xFF1d4ed8), Color(0xFF1e3a8a)),
                start = Offset(60f * scale, 172f * scale),
                end = Offset(140f * scale, 280f * scale)
            ),
            topLeft = Offset(60f * scale, 172f * scale),
            size = Size(80f * scale, 108f * scale),
            cornerRadius = CornerRadius(3f * scale, 3f * scale)
        )

        // Front bumper
        drawRoundRect(
            brush = Brush.linearGradient(
                colors = listOf(Color(0xFFf1f5f9), Color(0xFF94a3b8), Color(0xFF475569)),
                start = Offset(60f * scale, 12f * scale),
                end = Offset(60f * scale, 25f * scale)
            ),
            topLeft = Offset(60f * scale, 12f * scale),
            size = Size(80f * scale, 13f * scale),
            cornerRadius = CornerRadius(4f * scale, 4f * scale)
        )

        // Rear bumper
        drawRoundRect(
            brush = Brush.linearGradient(
                colors = listOf(Color(0xFFf1f5f9), Color(0xFF94a3b8), Color(0xFF475569)),
                start = Offset(60f * scale, 281f * scale),
                end = Offset(60f * scale, 293f * scale)
            ),
            topLeft = Offset(60f * scale, 281f * scale),
            size = Size(80f * scale, 12f * scale),
            cornerRadius = CornerRadius(4f * scale, 4f * scale)
        )
    }

    fun DrawScope.drawCanterBody(scale: Float) {
        // Ground shadow
        drawOval(
            color = Color(0x40000000), // rgba(0,0,0,0.25)
            topLeft = Offset(20f * scale, 290f * scale),
            size = Size(160f * scale, 20f * scale)
        )

        // Main body (Chassis footprint)
        val bodyPathStr = "M 70,18 Q 57,18 56,30 L 54,110 L 54,278 Q 54,288 70,290 L 130,290 Q 146,288 146,278 L 146,110 L 144,30 Q 143,18 130,18 Z"
        val bodyPath = PathParser.createPathFromPathData(bodyPathStr).asComposePath()
        bodyPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(
            path = bodyPath,
            brush = Brush.radialGradient(
                colors = listOf(Color(0xFFf8fafc), Color(0xFFe2e8f0), Color(0xFF94a3b8)),
                center = Offset(96f * scale, 105f * scale),
                radius = 124f * scale
            )
        )

        // Cargo box
        drawRoundRect(
            brush = Brush.linearGradient(
                colors = listOf(Color(0xFFcbd5e1), Color(0xFFf1f5f9), Color(0xFFf8fafc), Color(0xFFf1f5f9), Color(0xFFcbd5e1)),
                start = Offset(58f * scale, 128f * scale),
                end = Offset(142f * scale, 128f * scale)
            ),
            topLeft = Offset(58f * scale, 128f * scale),
            size = Size(84f * scale, 154f * scale),
            cornerRadius = CornerRadius(3f * scale, 3f * scale)
        )
    }
    
    // Quick fallback for other bodies for now, can be fully fleshed out later if needed
    fun DrawScope.drawGenericBody(scale: Float) {
        drawRoundRect(
            color = Color.LightGray,
            topLeft = Offset(50f * scale, 20f * scale),
            size = Size(100f * scale, 260f * scale),
            cornerRadius = CornerRadius(12f * scale, 12f * scale)
        )
    }
}
