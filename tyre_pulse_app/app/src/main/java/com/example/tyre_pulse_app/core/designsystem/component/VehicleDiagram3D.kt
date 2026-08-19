package com.example.tyre_pulse_app.core.designsystem.component

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.model.FittedTyre
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

// 3D Math primitives
private data class Point3D(val x: Float, val y: Float, val z: Float) {
    fun rotateY(angleRad: Float): Point3D {
        val c = cos(angleRad)
        val s = sin(angleRad)
        return Point3D(x * c - z * s, y, x * s + z * c)
    }

    fun rotateX(angleRad: Float): Point3D {
        val c = cos(angleRad)
        val s = sin(angleRad)
        return Point3D(x, y * c - z * s, y * s + z * c)
    }

    fun project(width: Float, height: Float, fov: Float, cameraDistance: Float): Offset {
        val scale = fov / (cameraDistance + z)
        val projX = width / 2f + x * scale
        val projY = height / 2f - y * scale // Flip Y for Compose Canvas space
        return Offset(projX, projY)
    }
}

private data class Face3D(val vertexIndices: List<Int>, val color: Color, val isOutlineOnly: Boolean = false)

@Composable
fun VehicleDiagram3D(
    vehicleType: String,
    fittedTyres: List<FittedTyre>,
    onTyreClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    // Interactive orbit state
    var yaw by remember { mutableStateOf(-0.6f) } // default angle for isometric view
    var pitch by remember { mutableStateOf(0.3f) }
    var zoom by remember { mutableStateOf(160f) }

    // Automatic drum rotation for Transit Mixer
    val infiniteTransition = rememberInfiniteTransition(label = "drumRotation")
    val drumAngle by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = (2 * Math.PI).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(4000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "drumAngle"
    )

    // Banners / lights blinkers
    val blinkState by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "blink"
    )

    // Layout configuration
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(300.dp)
            .background(Color.Black.copy(alpha = 0.05f), RoundedCornerShape(16.dp))
            .pointerInput(Unit) {
                detectDragGestures { change, dragAmount ->
                    change.consume()
                    yaw -= dragAmount.x * 0.005f
                    pitch = (pitch + dragAmount.y * 0.005f).coerceIn(-0.8f, 0.8f)
                }
            }
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val width = size.width
            val height = size.height
            val cameraDist = 8f

            // 1. Render Chassis Frame (Box)
            val chassisVertices = listOf(
                Point3D(-0.6f, -0.3f, -2.5f), // 0: back-bottom-left
                Point3D(0.6f, -0.3f, -2.5f),  // 1: back-bottom-right
                Point3D(0.6f, 0.0f, -2.5f),   // 2: back-top-right
                Point3D(-0.6f, 0.0f, -2.5f),  // 3: back-top-left
                Point3D(-0.6f, -0.3f, 2.5f),  // 4: front-bottom-left
                Point3D(0.6f, -0.3f, 2.5f),   // 5: front-bottom-right
                Point3D(0.6f, 0.0f, 2.5f),    // 6: front-top-right
                Point3D(-0.6f, 0.0f, 2.5f)     // 7: front-top-left
            ).map { it.rotateY(yaw).rotateX(pitch) }

            val chassisFaces = listOf(
                Face3D(listOf(0, 1, 2, 3), Color.DarkGray.copy(alpha = 0.8f)), // back
                Face3D(listOf(4, 5, 6, 7), Color.Gray.copy(alpha = 0.9f)),     // front
                Face3D(listOf(0, 4, 7, 3), Color.DarkGray.copy(alpha = 0.7f)), // left
                Face3D(listOf(1, 5, 6, 2), Color.DarkGray.copy(alpha = 0.7f)), // right
                Face3D(listOf(3, 2, 6, 7), Color.Gray)                        // top
            )

            drawShadedFaces(chassisFaces, chassisVertices, width, height, zoom, cameraDist)

            // 2. Render Front Cabin (Cab)
            val cabVertices = listOf(
                Point3D(-0.6f, 0.0f, 1.2f),  // 0: bottom-back-left
                Point3D(0.6f, 0.0f, 1.2f),   // 1: bottom-back-right
                Point3D(0.6f, 1.1f, 1.2f),   // 2: top-back-right
                Point3D(-0.6f, 1.1f, 1.2f),  // 3: top-back-left
                Point3D(-0.6f, 0.0f, 2.4f),  // 4: bottom-front-left
                Point3D(0.6f, 0.0f, 2.4f),   // 5: bottom-front-right
                Point3D(0.6f, 0.8f, 2.4f),   // 6: top-front-right
                Point3D(-0.6f, 0.8f, 2.4f)    // 7: top-front-left
            ).map { it.rotateY(yaw).rotateX(pitch) }

            val cabFaces = listOf(
                Face3D(listOf(0, 1, 2, 3), Color(0xFF0369A1)), // back (Sky blue)
                Face3D(listOf(4, 5, 6, 7), Color(0xFF0284C7)), // front
                Face3D(listOf(0, 4, 7, 3), Color(0xFF0284C7)), // left
                Face3D(listOf(1, 5, 6, 2), Color(0xFF0369A1)), // right
                Face3D(listOf(3, 2, 6, 7), Color(0xFF38BDF8))  // top/windshield
            )

            drawShadedFaces(cabFaces, cabVertices, width, height, zoom, cameraDist)

            // 3. Render Body attachments depending on type
            when (vehicleType.uppercase()) {
                "MIXER" -> {
                    // Transit mixer rotating drum (double-cone approximation)
                    val drumPoints = mutableListOf<Point3D>()
                    val segments = 8
                    val radius = 0.9f
                    // Draw revolving rings
                    for (i in 0..2) {
                        val zOffset = -1.6f + i * 1.1f
                        val currentRadius = if (i == 1) radius else radius * 0.6f
                        for (s in 0 until segments) {
                            val angle = (2 * Math.PI * s / segments).toFloat() + drumAngle
                            drumPoints.add(
                                Point3D(
                                    currentRadius * cos(angle),
                                    0.4f + currentRadius * sin(angle),
                                    zOffset
                                )
                            )
                        }
                    }

                    // Rotate and project drum points
                    val rotatedDrum = drumPoints.map { it.rotateY(yaw).rotateX(pitch) }
                    // Render drum mesh faces
                    for (i in 0 until 2) {
                        val r1 = i * segments
                        val r2 = (i + 1) * segments
                        for (s in 0 until segments) {
                            val nextS = (s + 1) % segments
                            val face = Face3D(
                                listOf(r1 + s, r1 + nextS, r2 + nextS, r2 + s),
                                Color(0xFFE2E8F0).copy(alpha = 0.85f)
                            )
                            drawShadedFaces(listOf(face), rotatedDrum, width, height, zoom, cameraDist)
                        }
                    }
                }
                "PUMP" -> {
                    // Concrete Pump fold-out articulated boom
                    val joint0 = Point3D(0f, 0.4f, -1.8f)
                    val joint1 = Point3D(0f, 1.4f, -1.0f)
                    val joint2 = Point3D(0.3f, 2.2f, 0.2f)

                    val pts = listOf(joint0, joint1, joint2).map { it.rotateY(yaw).rotateX(pitch) }
                    val p0 = pts[0].project(width, height, zoom, cameraDist)
                    val p1 = pts[1].project(width, height, zoom, cameraDist)
                    val p2 = pts[2].project(width, height, zoom, cameraDist)

                    // Draw boom arms
                    drawLine(Color(0xFFEA580C), p0, p1, strokeWidth = 8f)
                    drawLine(Color(0xFFF97316), p1, p2, strokeWidth = 6f)
                    drawCircle(Color.DarkGray, radius = 8f, center = p1)
                }
                else -> {
                    // Default / Cargo Box
                    val boxVertices = listOf(
                        Point3D(-0.7f, 0.0f, -2.4f), // 0
                        Point3D(0.7f, 0.0f, -2.4f),  // 1
                        Point3D(0.7f, 1.2f, -2.4f),  // 2
                        Point3D(-0.7f, 1.2f, -2.4f), // 3
                        Point3D(-0.7f, 0.0f, 0.8f),  // 4
                        Point3D(0.7f, 0.0f, 0.8f),   // 5
                        Point3D(0.7f, 1.2f, 0.8f),   // 6
                        Point3D(-0.7f, 1.2f, 0.8f)    // 7
                    ).map { it.rotateY(yaw).rotateX(pitch) }

                    val boxFaces = listOf(
                        Face3D(listOf(0, 1, 2, 3), Color(0xFF475569)),
                        Face3D(listOf(4, 5, 6, 7), Color(0xFF64748B)),
                        Face3D(listOf(0, 4, 7, 3), Color(0xFF475569)),
                        Face3D(listOf(1, 5, 6, 2), Color(0xFF334155)),
                        Face3D(listOf(3, 2, 6, 7), Color(0xFF94A3B8))
                    )
                    drawShadedFaces(boxFaces, boxVertices, width, height, zoom, cameraDist)
                }
            }

            // 4. Render Headlights & Glowing blinkers
            val headLights = listOf(
                Point3D(-0.45f, -0.15f, 2.52f), // Left headlight
                Point3D(0.45f, -0.15f, 2.52f)   // Right headlight
            ).map { it.rotateY(yaw).rotateX(pitch) }

            headLights.forEach { lt ->
                val p = lt.project(width, height, zoom, cameraDist)
                if (lt.z < 0) { // front-facing highlight
                    drawCircle(
                        color = Color(0xFFFDE047).copy(alpha = 0.6f + 0.4f * blinkState),
                        radius = 12f,
                        center = p
                    )
                    drawCircle(
                        color = Color.White,
                        radius = 5f,
                        center = p
                    )
                }
            }

            // 5. Render Tyres (Interactive Nodes)
            // Tyres coordinates mapping
            val tyrePositions = listOf(
                Pair("FL", Point3D(-0.72f, -0.5f, 1.6f)),
                Pair("FR", Point3D(0.72f, -0.5f, 1.6f)),
                Pair("RL1", Point3D(-0.72f, -0.5f, -1.0f)),
                Pair("RL2", Point3D(-0.88f, -0.5f, -1.0f)),
                Pair("RR1", Point3D(0.72f, -0.5f, -1.0f)),
                Pair("RR2", Point3D(0.88f, -0.5f, -1.0f)),
                Pair("RL3", Point3D(-0.72f, -0.5f, -1.8f)),
                Pair("RL4", Point3D(-0.88f, -0.5f, -1.8f)),
                Pair("RR3", Point3D(0.72f, -0.5f, -1.8f)),
                Pair("RR4", Point3D(0.88f, -0.5f, -1.8f))
            )

            tyrePositions.forEach { (posName, coords) ->
                // Check if this tyre exists in fittedTyres list
                val tyreInfo = fittedTyres.firstOrNull { it.position.uppercase() == posName }
                if (tyreInfo != null) {
                    val rotCoords = coords.rotateY(yaw).rotateX(pitch)
                    val pScreen = rotCoords.project(width, height, zoom, cameraDist)

                    // Determine colour based on condition
                    val condColor = when (tyreInfo.condition?.lowercase()) {
                        "good" -> Color(0xFF10B981) // Green
                        "warning", "worn" -> Color(0xFFF59E0B) // Amber
                        "critical", "danger" -> Color(0xFFEF4444) // Red
                        else -> Color(0xFF94A3B8) // Slate Gray
                    }

                    // Draw outer tyre glow
                    drawCircle(
                        color = condColor.copy(alpha = 0.25f),
                        radius = 24f,
                        center = pScreen
                    )

                    // Draw tyre body (shaded cylinder representation)
                    drawCircle(
                        color = Color(0xFF1E293B),
                        radius = 16f,
                        center = pScreen
                    )

                    // Draw inner alloy / condition core
                    drawCircle(
                        color = condColor,
                        radius = 8f,
                        center = pScreen
                    )

                    // Overlay tiny position label text
                    // (we can draw details or simple indicator)
                }
            }
        }

        // Tap interface layer
        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(fittedTyres, yaw, pitch, zoom) {
                    detectDragGestures(
                        onDrag = { change, dragAmount ->
                            // Orbit adjustment handled above
                        },
                        onDragEnd = {
                            // Tap detection
                        }
                    )
                }
                .pointerInput(fittedTyres, yaw, pitch, zoom) {
                    // Check direct taps
                    detectTap { tapOffset ->
                        val width = size.width.toFloat()
                        val height = size.height.toFloat()
                        val cameraDist = 8f

                        val tyrePositions = listOf(
                            Pair("FL", Point3D(-0.72f, -0.5f, 1.6f)),
                            Pair("FR", Point3D(0.72f, -0.5f, 1.6f)),
                            Pair("RL1", Point3D(-0.72f, -0.5f, -1.0f)),
                            Pair("RL2", Point3D(-0.88f, -0.5f, -1.0f)),
                            Pair("RR1", Point3D(0.72f, -0.5f, -1.0f)),
                            Pair("RR2", Point3D(0.88f, -0.5f, -1.0f)),
                            Pair("RL3", Point3D(-0.72f, -0.5f, -1.8f)),
                            Pair("RL4", Point3D(-0.88f, -0.5f, -1.8f)),
                            Pair("RR3", Point3D(0.72f, -0.5f, -1.8f)),
                            Pair("RR4", Point3D(0.88f, -0.5f, -1.8f))
                        )

                        var tappedPosition: String? = null
                        var closestDist = Float.MAX_VALUE

                        tyrePositions.forEach { (posName, coords) ->
                            val tyreInfo = fittedTyres.firstOrNull { it.position.uppercase() == posName }
                            if (tyreInfo != null) {
                                val rotCoords = coords.rotateY(yaw).rotateX(pitch)
                                val pScreen = rotCoords.project(width, height, zoom, cameraDist)

                                val dx = tapOffset.x - pScreen.x
                                val dy = tapOffset.y - pScreen.y
                                val dist = sqrt(dx * dx + dy * dy)

                                if (dist < 40f && dist < closestDist) {
                                    closestDist = dist
                                    tappedPosition = tyreInfo.id // Return fitted tyre ID
                                }
                            }
                        }

                        tappedPosition?.let { onTyreClick(it) }
                    }
                }
        )

        // Helper instruction text
        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Info,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                modifier = Modifier.size(16.dp)
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = "Drag to rotate vehicle. Tap tyres to inspect.",
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

// Gesture helper
private suspend fun androidx.compose.ui.input.pointer.PointerInputScope.detectTap(
    onTap: (Offset) -> Unit
) {
    androidx.compose.foundation.gestures.detectTapGestures(
        onTap = { offset -> onTap(offset) }
    )
}

// Drawing helper
private fun DrawScope.drawShadedFaces(
    faces: List<Face3D>,
    vertices: List<Point3D>,
    width: Float,
    height: Float,
    fov: Float,
    cameraDistance: Float
) {
    faces.forEach { face ->
        val path = Path()
        var valid = true
        face.vertexIndices.forEachIndexed { index, vIdx ->
            if (vIdx >= vertices.size) {
                valid = false
                return@forEachIndexed
            }
            val p = vertices[vIdx].project(width, height, fov, cameraDistance)
            if (index == 0) {
                path.moveTo(p.x, p.y)
            } else {
                path.lineTo(p.x, p.y)
            }
        }
        if (valid) {
            path.close()
            // Dynamic shading based on Z position of first vertex (fake light source from top-front)
            val zSum = face.vertexIndices.map { vertices[it].z }.average().toFloat()
            val shadingFactor = ((zSum + 3f) / 6f).coerceIn(0.2f, 1.0f)
            val finalColor = face.color.copy(
                red = face.color.red * shadingFactor,
                green = face.color.green * shadingFactor,
                blue = face.color.blue * shadingFactor
            )

            drawPath(
                path = path,
                color = finalColor,
                style = Fill
            )
            drawPath(
                path = path,
                color = Color.Black.copy(alpha = 0.15f),
                style = Stroke(width = 1.dp.toPx())
            )
        }
    }
}
