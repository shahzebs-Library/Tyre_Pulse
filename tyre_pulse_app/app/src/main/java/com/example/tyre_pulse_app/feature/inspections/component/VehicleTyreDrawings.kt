package com.example.tyre_pulse_app.feature.inspections.component

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.core.graphics.PathParser

object VehicleTyreDrawings {

    private fun DrawScope.drawHeadlightsAndBlinkers(scale: Float, blinkPhase: Float, yFront: Float, yRear: Float, wLeft: Float, wRight: Float) {
        val blinkAlpha = 0.2f + (0.8f * blinkPhase)
        
        // Headlights (Front)
        val hlRadius = 16f * scale
        val hlBrushLeft = Brush.radialGradient(
            colors = listOf(Color.White.copy(alpha = 0.9f), Color(0xFFe0f2fe).copy(alpha = 0.4f), Color.Transparent),
            center = Offset(wLeft, yFront),
            radius = hlRadius
        )
        val hlBrushRight = Brush.radialGradient(
            colors = listOf(Color.White.copy(alpha = 0.9f), Color(0xFFe0f2fe).copy(alpha = 0.4f), Color.Transparent),
            center = Offset(wRight, yFront),
            radius = hlRadius
        )
        drawCircle(brush = hlBrushLeft, radius = hlRadius, center = Offset(wLeft, yFront))
        drawCircle(brush = hlBrushRight, radius = hlRadius, center = Offset(wRight, yFront))

        // Blinkers (Front)
        val blRadius = 8f * scale
        val blBrushLeftFront = Brush.radialGradient(
            colors = listOf(Color(0xFFf59e0b).copy(alpha = blinkAlpha), Color.Transparent),
            center = Offset(wLeft - 8f * scale, yFront),
            radius = blRadius
        )
        val blBrushRightFront = Brush.radialGradient(
            colors = listOf(Color(0xFFf59e0b).copy(alpha = blinkAlpha), Color.Transparent),
            center = Offset(wRight + 8f * scale, yFront),
            radius = blRadius
        )
        drawCircle(brush = blBrushLeftFront, radius = blRadius, center = Offset(wLeft - 8f * scale, yFront))
        drawCircle(brush = blBrushRightFront, radius = blRadius, center = Offset(wRight + 8f * scale, yFront))

        // Blinkers (Rear)
        val blBrushLeftRear = Brush.radialGradient(
            colors = listOf(Color(0xFFef4444).copy(alpha = blinkAlpha), Color.Transparent),
            center = Offset(wLeft, yRear),
            radius = blRadius
        )
        val blBrushRightRear = Brush.radialGradient(
            colors = listOf(Color(0xFFef4444).copy(alpha = blinkAlpha), Color.Transparent),
            center = Offset(wRight, yRear),
            radius = blRadius
        )
        drawCircle(brush = blBrushLeftRear, radius = blRadius, center = Offset(wLeft, yRear))
        drawCircle(brush = blBrushRightRear, radius = blRadius, center = Offset(wRight, yRear))
    }

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

        drawOval(
            color = Color(0x66020617),
            topLeft = Offset(x - 1.6f * scale, y + 2.4f * scale),
            size = Size(w + 3.2f * scale, h + 2.4f * scale)
        )

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

        if (isSelected) {
            drawRoundRect(
                color = Color(0xFF3b82f6),
                topLeft = Offset(x - 3f * scale, y - 3f * scale),
                size = Size(w + 6 * scale, h + 6 * scale),
                cornerRadius = CornerRadius(w * 0.3f + 1 * scale, w * 0.3f + 1 * scale),
                style = Stroke(width = 2.5f * scale)
            )
        }

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

    fun DrawScope.drawPickupBody(scale: Float, blinkPhase: Float) {
        drawOval(color = Color(0x4D000000), topLeft = Offset(22f * scale, 295f * scale), size = Size(156f * scale, 20f * scale))
        val roofPathStr = "M 72,22 Q 60,22 58,36 L 56,70 L 56,275 Q 56,286 72,288 L 128,288 Q 144,286 144,275 L 144,70 L 142,36 Q 140,22 128,22 Z"
        val roofPath = PathParser.createPathFromPathData(roofPathStr).asComposePath()
        roofPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = roofPath, brush = Brush.radialGradient(colors = listOf(Color(0xFF93c5fd), Color(0xFF3b82f6), Color(0xFF1d4ed8), Color(0xFF1e3a8a)), center = Offset(96f * scale, 120f * scale), radius = 120f * scale))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF1e3a8a), Color(0xFF2563eb), Color(0xFF60a5fa), Color(0xFF2563eb), Color(0xFF1e3a8a)), start = Offset(60f * scale, 22f * scale), end = Offset(140f * scale, 22f * scale)), topLeft = Offset(60f * scale, 22f * scale), size = Size(80f * scale, 52f * scale), cornerRadius = CornerRadius(5f * scale, 5f * scale))
        val wsPathStr = "M 65,74 L 135,74 L 131,96 L 69,96 Z"
        val wsPath = PathParser.createPathFromPathData(wsPathStr).asComposePath()
        wsPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = wsPath, brush = Brush.linearGradient(colors = listOf(Color(0xF2dbeafe), Color(0xD993c5fd), Color(0x993b82f6)), start = Offset(65f * scale, 74f * scale), end = Offset(135f * scale, 96f * scale)))
        drawRoundRect(brush = Brush.radialGradient(colors = listOf(Color(0xFF3b82f6), Color(0xFF1e3a8a)), center = Offset(100f * scale, 128f * scale), radius = 64f * scale), topLeft = Offset(60f * scale, 96f * scale), size = Size(80f * scale, 64f * scale), cornerRadius = CornerRadius(3f * scale, 3f * scale))
        val rwPathStr = "M 68,158 L 132,158 L 130,169 L 70,169 Z"
        val rwPath = PathParser.createPathFromPathData(rwPathStr).asComposePath()
        rwPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = rwPath, brush = Brush.linearGradient(colors = listOf(Color(0xF2dbeafe), Color(0xD993c5fd), Color(0x993b82f6)), start = Offset(68f * scale, 158f * scale), end = Offset(132f * scale, 169f * scale)))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF1e3a8a), Color(0xFF1d4ed8), Color(0xFF1e3a8a)), start = Offset(60f * scale, 172f * scale), end = Offset(140f * scale, 280f * scale)), topLeft = Offset(60f * scale, 172f * scale), size = Size(80f * scale, 108f * scale), cornerRadius = CornerRadius(3f * scale, 3f * scale))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFFf1f5f9), Color(0xFF94a3b8), Color(0xFF475569)), start = Offset(60f * scale, 12f * scale), end = Offset(60f * scale, 25f * scale)), topLeft = Offset(60f * scale, 12f * scale), size = Size(80f * scale, 13f * scale), cornerRadius = CornerRadius(4f * scale, 4f * scale))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFFf1f5f9), Color(0xFF94a3b8), Color(0xFF475569)), start = Offset(60f * scale, 281f * scale), end = Offset(60f * scale, 293f * scale)), topLeft = Offset(60f * scale, 281f * scale), size = Size(80f * scale, 12f * scale), cornerRadius = CornerRadius(4f * scale, 4f * scale))
        
        drawHeadlightsAndBlinkers(scale, blinkPhase, 16f * scale, 285f * scale, 68f * scale, 132f * scale)
    }

    fun DrawScope.drawPickupL300Body(scale: Float, blinkPhase: Float) {
        drawOval(color = Color(0x4D000000), topLeft = Offset(22f * scale, 275f * scale), size = Size(156f * scale, 20f * scale))
        val bodyPathStr = "M 66,10 L 134,10 L 140,20 L 140,260 Q 140,270 128,270 L 72,270 Q 60,270 60,260 L 60,20 Z"
        val bodyPath = PathParser.createPathFromPathData(bodyPathStr).asComposePath()
        bodyPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = bodyPath, brush = Brush.radialGradient(colors = listOf(Color.White, Color(0xFFcbd5e1), Color(0xFF94a3b8)), center = Offset(100f * scale, 140f * scale), radius = 150f * scale))
        
        val wsPathStr = "M 63,14 L 137,14 L 133,40 L 67,40 Z"
        val wsPath = PathParser.createPathFromPathData(wsPathStr).asComposePath()
        wsPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = wsPath, brush = Brush.linearGradient(colors = listOf(Color(0xF2dbeafe), Color(0xD993c5fd), Color(0x993b82f6)), start = Offset(63f * scale, 14f * scale), end = Offset(137f * scale, 40f * scale)))
        
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF94a3b8), Color(0xFF64748b), Color(0xFF94a3b8)), start = Offset(62f * scale, 70f * scale), end = Offset(138f * scale, 260f * scale)), topLeft = Offset(62f * scale, 70f * scale), size = Size(76f * scale, 190f * scale), cornerRadius = CornerRadius(2f * scale, 2f * scale))

        drawHeadlightsAndBlinkers(scale, blinkPhase, 10f * scale, 265f * scale, 68f * scale, 132f * scale)
    }

    fun DrawScope.drawPickupIsuzuBody(scale: Float, blinkPhase: Float) {
        drawOval(color = Color(0x4D000000), topLeft = Offset(22f * scale, 305f * scale), size = Size(156f * scale, 20f * scale))
        val bodyPathStr = "M 70,18 Q 58,18 56,32 L 52,80 L 54,285 Q 54,295 70,295 L 130,295 Q 146,295 146,285 L 148,80 L 144,32 Q 142,18 130,18 Z"
        val bodyPath = PathParser.createPathFromPathData(bodyPathStr).asComposePath()
        bodyPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = bodyPath, brush = Brush.radialGradient(colors = listOf(Color(0xFFfca5a5), Color(0xFFef4444), Color(0xFFb91c1c), Color(0xFF7f1d1d)), center = Offset(100f * scale, 140f * scale), radius = 150f * scale))
        
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFFb91c1c), Color(0xFFef4444), Color(0xFFfca5a5), Color(0xFFef4444), Color(0xFFb91c1c)), start = Offset(56f * scale, 22f * scale), end = Offset(144f * scale, 22f * scale)), topLeft = Offset(62f * scale, 22f * scale), size = Size(76f * scale, 60f * scale), cornerRadius = CornerRadius(5f * scale, 5f * scale))
        
        val wsPathStr = "M 61,84 L 139,84 L 133,106 L 67,106 Z"
        val wsPath = PathParser.createPathFromPathData(wsPathStr).asComposePath()
        wsPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = wsPath, brush = Brush.linearGradient(colors = listOf(Color(0xF2dbeafe), Color(0xD993c5fd), Color(0x993b82f6)), start = Offset(61f * scale, 84f * scale), end = Offset(139f * scale, 106f * scale)))
        
        val rwPathStr = "M 66,168 L 134,168 L 132,179 L 68,179 Z"
        val rwPath = PathParser.createPathFromPathData(rwPathStr).asComposePath()
        rwPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = rwPath, brush = Brush.linearGradient(colors = listOf(Color(0xF2dbeafe), Color(0xD993c5fd), Color(0x993b82f6)), start = Offset(66f * scale, 168f * scale), end = Offset(134f * scale, 179f * scale)))
        
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF7f1d1d), Color(0xFF991b1b), Color(0xFF7f1d1d)), start = Offset(58f * scale, 182f * scale), end = Offset(142f * scale, 290f * scale)), topLeft = Offset(58f * scale, 182f * scale), size = Size(84f * scale, 108f * scale), cornerRadius = CornerRadius(3f * scale, 3f * scale))

        drawHeadlightsAndBlinkers(scale, blinkPhase, 20f * scale, 292f * scale, 66f * scale, 134f * scale)
    }

    fun DrawScope.drawSkidLoaderBody(scale: Float, blinkPhase: Float) {
        drawOval(color = Color(0x4D000000), topLeft = Offset(15f * scale, 180f * scale), size = Size(170f * scale, 20f * scale))
        drawRoundRect(brush = Brush.radialGradient(colors = listOf(Color(0xFFfcd34d), Color(0xFFf59e0b), Color(0xFFd97706)), center = Offset(100f * scale, 120f * scale), radius = 80f * scale), topLeft = Offset(50f * scale, 40f * scale), size = Size(100f * scale, 140f * scale), cornerRadius = CornerRadius(10f * scale, 10f * scale))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF334155), Color(0xFF1e293b)), start = Offset(55f * scale, 70f * scale), end = Offset(145f * scale, 120f * scale)), topLeft = Offset(60f * scale, 70f * scale), size = Size(80f * scale, 50f * scale), cornerRadius = CornerRadius(4f * scale, 4f * scale))
        
        drawRoundRect(color = Color(0xFF1e293b), topLeft = Offset(40f * scale, 10f * scale), size = Size(120f * scale, 30f * scale), cornerRadius = CornerRadius(2f * scale, 2f * scale))
        drawRoundRect(color = Color(0xFF475569), topLeft = Offset(45f * scale, 30f * scale), size = Size(20f * scale, 90f * scale), cornerRadius = CornerRadius(2f * scale, 2f * scale))
        drawRoundRect(color = Color(0xFF475569), topLeft = Offset(135f * scale, 30f * scale), size = Size(20f * scale, 90f * scale), cornerRadius = CornerRadius(2f * scale, 2f * scale))

        drawHeadlightsAndBlinkers(scale, blinkPhase, 42f * scale, 175f * scale, 65f * scale, 135f * scale)
    }

    fun DrawScope.drawForkliftBody(scale: Float, blinkPhase: Float) {
        drawOval(color = Color(0x4D000000), topLeft = Offset(20f * scale, 200f * scale), size = Size(160f * scale, 20f * scale))
        drawRoundRect(brush = Brush.radialGradient(colors = listOf(Color(0xFFfb923c), Color(0xFFea580c), Color(0xFFc2410c)), center = Offset(100f * scale, 140f * scale), radius = 80f * scale), topLeft = Offset(50f * scale, 60f * scale), size = Size(100f * scale, 130f * scale), cornerRadius = CornerRadius(20f * scale, 20f * scale))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF94a3b8), Color(0xFF475569)), start = Offset(60f * scale, 80f * scale), end = Offset(140f * scale, 80f * scale)), topLeft = Offset(60f * scale, 80f * scale), size = Size(80f * scale, 50f * scale), cornerRadius = CornerRadius(5f * scale, 5f * scale))
        
        drawRect(color = Color(0xFF1e293b), topLeft = Offset(70f * scale, 30f * scale), size = Size(60f * scale, 30f * scale))
        drawRect(color = Color(0xFF475569), topLeft = Offset(75f * scale, 5f * scale), size = Size(10f * scale, 80f * scale))
        drawRect(color = Color(0xFF475569), topLeft = Offset(115f * scale, 5f * scale), size = Size(10f * scale, 80f * scale))
        
        drawHeadlightsAndBlinkers(scale, blinkPhase, 60f * scale, 185f * scale, 60f * scale, 140f * scale)
    }

    fun DrawScope.drawCanterBody(scale: Float, blinkPhase: Float) {
        drawOval(color = Color(0x40000000), topLeft = Offset(20f * scale, 290f * scale), size = Size(160f * scale, 20f * scale))
        val bodyPathStr = "M 70,18 Q 57,18 56,30 L 54,110 L 54,278 Q 54,288 70,290 L 130,290 Q 146,288 146,278 L 146,110 L 144,30 Q 143,18 130,18 Z"
        val bodyPath = PathParser.createPathFromPathData(bodyPathStr).asComposePath()
        bodyPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = bodyPath, brush = Brush.radialGradient(colors = listOf(Color(0xFFf8fafc), Color(0xFFe2e8f0), Color(0xFF94a3b8)), center = Offset(96f * scale, 105f * scale), radius = 124f * scale))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFFcbd5e1), Color(0xFFf1f5f9), Color(0xFFf8fafc), Color(0xFFf1f5f9), Color(0xFFcbd5e1)), start = Offset(58f * scale, 128f * scale), end = Offset(142f * scale, 128f * scale)), topLeft = Offset(58f * scale, 128f * scale), size = Size(84f * scale, 154f * scale), cornerRadius = CornerRadius(3f * scale, 3f * scale))

        drawHeadlightsAndBlinkers(scale, blinkPhase, 20f * scale, 285f * scale, 68f * scale, 132f * scale)
    }
    
    fun DrawScope.drawTriMixerBody(scale: Float, blinkPhase: Float, drumRotationPhase: Float) {
        drawOval(color = Color(0x40000000), topLeft = Offset(20f * scale, 342f * scale), size = Size(160f * scale, 20f * scale))
        val cabPathStr = "M 70,14 Q 57,14 56,28 L 54,108 L 54,125 L 146,125 L 146,108 L 144,28 Q 143,14 130,14 Z"
        val cabPath = PathParser.createPathFromPathData(cabPathStr).asComposePath()
        cabPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = cabPath, brush = Brush.radialGradient(colors = listOf(Color(0xFFffffff), Color(0xFFf1f5f9), Color(0xFFcbd5e1)), center = Offset(96f * scale, 90f * scale), radius = 120f * scale))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF94a3b8), Color(0xFFe2e8f0), Color(0xFFffffff), Color(0xFFe2e8f0), Color(0xFF94a3b8)), start = Offset(60f * scale, 21f * scale), end = Offset(140f * scale, 21f * scale)), topLeft = Offset(60f * scale, 21f * scale), size = Size(80f * scale, 42f * scale), cornerRadius = CornerRadius(4f * scale, 4f * scale))
        val wsPathStr = "M 63,63 L 137,63 L 133,80 L 67,80 Z"
        val wsPath = PathParser.createPathFromPathData(wsPathStr).asComposePath()
        wsPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = wsPath, brush = Brush.linearGradient(colors = listOf(Color(0xF2dbeafe), Color(0xD993c5fd), Color(0x993b82f6)), start = Offset(63f * scale, 63f * scale), end = Offset(137f * scale, 80f * scale)))
        drawRect(Color(0xFF334155), Offset(68f * scale, 126f * scale), Size(12f * scale, 215f * scale))
        drawRect(Color(0xFF334155), Offset(120f * scale, 126f * scale), Size(12f * scale, 215f * scale))
        for(i in 0..3) {
            drawRect(Color(0xFF475569), Offset(68f * scale, (148f + i * 50f) * scale), Size(64f * scale, 6f * scale))
        }

        // Animated Mixer Drum
        val drumRect = androidx.compose.ui.geometry.Rect(56f * scale, 128f * scale, 144f * scale, 328f * scale)
        clipRect(left = drumRect.left, top = drumRect.top, right = drumRect.right, bottom = drumRect.bottom) {
            drawOval(
                brush = Brush.radialGradient(colors = listOf(Color(0xFFffffff), Color(0xFFe2e8f0), Color(0xFF94a3b8), Color(0xFF475569)), center = Offset(100f * scale, 228f * scale), radius = 110f * scale),
                topLeft = Offset(drumRect.left, drumRect.top),
                size = Size(drumRect.width, drumRect.height)
            )
            // Animated stripes
            val stripeOffset = drumRotationPhase * 60f * scale
            for (i in -2..10) {
                val yLine = 128f * scale + i * 30f * scale + stripeOffset
                drawRect(
                    color = Color.Black.copy(alpha = 0.1f),
                    topLeft = Offset(56f * scale, yLine),
                    size = Size(88f * scale, 8f * scale)
                )
            }
        }
        drawOval(color = Color(0xFF94a3b8), topLeft = Offset(drumRect.left, drumRect.top), size = Size(drumRect.width, drumRect.height), style = Stroke(width = 1.5f * scale))

        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF004d26), Color(0xFF00A850), Color(0xFF004d26)), start = Offset(70f * scale, 315f * scale), end = Offset(130f * scale, 315f * scale)), topLeft = Offset(70f * scale, 315f * scale), size = Size(60f * scale, 24f * scale), cornerRadius = CornerRadius(4f * scale, 4f * scale))

        drawHeadlightsAndBlinkers(scale, blinkPhase, 18f * scale, 335f * scale, 68f * scale, 132f * scale)
    }

    fun DrawScope.drawConcretePumpBody(scale: Float, blinkPhase: Float) {
        drawConcretePumpBase(scale, 352f, 250f, 320f)
        drawHeadlightsAndBlinkers(scale, blinkPhase, 18f * scale, 345f * scale, 68f * scale, 132f * scale)
    }

    fun DrawScope.drawConcretePump4AxleBody(scale: Float, blinkPhase: Float) {
        drawConcretePumpBase(scale, 312f, 210f, 280f)
        drawHeadlightsAndBlinkers(scale, blinkPhase, 18f * scale, 305f * scale, 68f * scale, 132f * scale)
    }

    private fun DrawScope.drawConcretePumpBase(scale: Float, shadowY: Float, machineryY: Float, hopperY: Float) {
        drawOval(color = Color(0x40000000), topLeft = Offset(10f * scale, shadowY * scale), size = Size(180f * scale, 22f * scale))
        val cabPathStr = "M 70,14 Q 57,14 56,28 L 54,110 L 54,128 L 146,128 L 146,110 L 144,28 Q 143,14 130,14 Z"
        val cabPath = PathParser.createPathFromPathData(cabPathStr).asComposePath()
        cabPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = cabPath, brush = Brush.radialGradient(colors = listOf(Color(0xFFffffff), Color(0xFFf1f5f9), Color(0xFFcbd5e1)), center = Offset(96f * scale, 90f * scale), radius = 120f * scale))
        val wsPathStr = "M 63,65 L 137,65 L 133,83 L 67,83 Z"
        val wsPath = PathParser.createPathFromPathData(wsPathStr).asComposePath()
        wsPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = wsPath, brush = Brush.linearGradient(colors = listOf(Color(0xF2dbeafe), Color(0xD993c5fd), Color(0x993b82f6)), start = Offset(63f * scale, 65f * scale), end = Offset(137f * scale, 83f * scale)))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF004d26), Color(0xFF00A850), Color(0xFF004d26)), start = Offset(40f * scale, 150f * scale), end = Offset(160f * scale, 150f * scale)), topLeft = Offset(40f * scale, 150f * scale), size = Size(120f * scale, 40f * scale), cornerRadius = CornerRadius(8f * scale, 8f * scale))
        drawOval(brush = Brush.radialGradient(colors = listOf(Color(0xFFffffff), Color(0xFFf1f5f9), Color(0xFFcbd5e1)), center = Offset(100f * scale, machineryY * scale + 20f * scale), radius = 60f * scale), topLeft = Offset(60f * scale, machineryY * scale), size = Size(80f * scale, 90f * scale))
        drawRoundRect(brush = Brush.radialGradient(colors = listOf(Color(0xFF4ade80), Color(0xFF16a34a), Color(0xFF14532d)), center = Offset(100f * scale, hopperY * scale + 10f * scale), radius = 40f * scale), topLeft = Offset(60f * scale, hopperY * scale), size = Size(80f * scale, 30f * scale), cornerRadius = CornerRadius(6f * scale, 6f * scale))
    }

    fun DrawScope.drawWheelLoaderBody(scale: Float, blinkPhase: Float) {
        drawOval(color = Color(0x40000000), topLeft = Offset(10f * scale, 230f * scale), size = Size(180f * scale, 22f * scale))
        val rearPathStr = "M 54,130 L 146,130 L 140,240 L 60,240 Z"
        val rearPath = PathParser.createPathFromPathData(rearPathStr).asComposePath()
        rearPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = rearPath, brush = Brush.linearGradient(colors = listOf(Color(0xFFf59e0b), Color(0xFFd97706), Color(0xFFb45309)), start = Offset(54f * scale, 130f * scale), end = Offset(146f * scale, 130f * scale)))
        val cabPathStr = "M 66,134 L 134,134 L 128,190 L 72,190 Z"
        val cabPath = PathParser.createPathFromPathData(cabPathStr).asComposePath()
        cabPath.transform(android.graphics.Matrix().apply { setScale(scale, scale) })
        drawPath(path = cabPath, brush = Brush.linearGradient(colors = listOf(Color(0xF2dbeafe), Color(0xD993c5fd), Color(0x993b82f6)), start = Offset(66f * scale, 134f * scale), end = Offset(134f * scale, 190f * scale)))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF334155), Color(0xFF1e293b)), start = Offset(70f * scale, 40f * scale), end = Offset(130f * scale, 40f * scale)), topLeft = Offset(70f * scale, 40f * scale), size = Size(60f * scale, 90f * scale), cornerRadius = CornerRadius(4f * scale, 4f * scale))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFFcbd5e1), Color(0xFF94a3b8)), start = Offset(40f * scale, 10f * scale), end = Offset(160f * scale, 10f * scale)), topLeft = Offset(40f * scale, 10f * scale), size = Size(120f * scale, 30f * scale), cornerRadius = CornerRadius(2f * scale, 2f * scale))
        
        drawHeadlightsAndBlinkers(scale, blinkPhase, 40f * scale, 235f * scale, 65f * scale, 135f * scale)
    }

    fun DrawScope.drawTrailerBody(scale: Float, blinkPhase: Float) {
        drawOval(color = Color(0x40000000), topLeft = Offset(10f * scale, 260f * scale), size = Size(180f * scale, 20f * scale))
        drawRoundRect(brush = Brush.linearGradient(colors = listOf(Color(0xFF94a3b8), Color(0xFFe2e8f0), Color(0xFF94a3b8)), start = Offset(30f * scale, 20f * scale), end = Offset(170f * scale, 20f * scale)), topLeft = Offset(30f * scale, 20f * scale), size = Size(140f * scale, 240f * scale), cornerRadius = CornerRadius(6f * scale, 6f * scale))
        for(i in 1..8) {
            drawRect(color = Color(0xFF475569).copy(alpha = 0.5f), topLeft = Offset(30f * scale, (20f + i * 26f) * scale), size = Size(140f * scale, 4f * scale))
        }

        // Only rear blinkers and tail lights for trailers
        val blRadius = 8f * scale
        val blinkAlpha = 0.2f + (0.8f * blinkPhase)
        val tailBrushLeft = Brush.radialGradient(colors = listOf(Color.Red.copy(alpha = 0.8f), Color.Transparent), center = Offset(40f * scale, 255f * scale), radius = blRadius)
        val tailBrushRight = Brush.radialGradient(colors = listOf(Color.Red.copy(alpha = 0.8f), Color.Transparent), center = Offset(160f * scale, 255f * scale), radius = blRadius)
        drawCircle(brush = tailBrushLeft, radius = blRadius, center = Offset(40f * scale, 255f * scale))
        drawCircle(brush = tailBrushRight, radius = blRadius, center = Offset(160f * scale, 255f * scale))
        
        val blBrushLeft = Brush.radialGradient(colors = listOf(Color(0xFFf59e0b).copy(alpha = blinkAlpha), Color.Transparent), center = Offset(50f * scale, 255f * scale), radius = blRadius)
        val blBrushRight = Brush.radialGradient(colors = listOf(Color(0xFFf59e0b).copy(alpha = blinkAlpha), Color.Transparent), center = Offset(150f * scale, 255f * scale), radius = blRadius)
        drawCircle(brush = blBrushLeft, radius = blRadius, center = Offset(50f * scale, 255f * scale))
        drawCircle(brush = blBrushRight, radius = blRadius, center = Offset(150f * scale, 255f * scale))
    }

    fun DrawScope.drawGenericBody(scale: Float) {
        drawRoundRect(color = Color(0xFFcbd5e1), topLeft = Offset(60f * scale, 40f * scale), size = Size(80f * scale, 120f * scale), cornerRadius = CornerRadius(8f * scale, 8f * scale))
    }
}
