package com.example.tyre_pulse_app.core.designsystem.component

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/** Inline sparkline for KPI tiles — tiny, no axes, just the trend line. */
@Composable
fun SparklineChart(
    data: List<Float>,
    color: Color = MaterialTheme.colorScheme.primary,
    modifier: Modifier = Modifier
) {
    if (data.size < 2) return
    val max = data.max()
    val min = data.min()
    val range = (max - min).coerceAtLeast(0.01f)
    val animProgress by animateFloatAsState(
        targetValue = 1f,
        animationSpec = tween(900, easing = FastOutSlowInEasing),
        label = "spark"
    )
    Canvas(modifier = modifier) {
        val w = size.width; val h = size.height; val step = w / (data.size - 1)
        val path = Path(); val gPath = Path()
        data.forEachIndexed { i, value ->
            val x = i * step; val y = h - ((value - min) / range) * h * animProgress
            if (i == 0) { path.moveTo(x, y); gPath.moveTo(x, h); gPath.lineTo(x, y) }
            else { path.lineTo(x, y); gPath.lineTo(x, y) }
        }
        gPath.lineTo((data.size - 1) * step, h); gPath.close()
        drawPath(gPath, brush = Brush.verticalGradient(listOf(color.copy(alpha = 0.25f), Color.Transparent)))
        drawPath(path, color, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        val lastX = (data.size - 1) * step
        val lastY = h - ((data.last() - min) / range) * h * animProgress
        drawCircle(color, 4.dp.toPx(), Offset(lastX, lastY))
    }
}

/** Full line chart with multiple series. */
@Composable
fun TPLineChart(
    series: List<Pair<String, List<Float>>>,
    modifier: Modifier = Modifier
) {
    val palette = listOf(Color(0xFF10B981), Color(0xFF38BDF8), Color(0xFFF59E0B), Color(0xFFEF4444))
    val allData = series.flatMap { it.second }
    val max = allData.maxOrNull() ?: 1f; val min = (allData.minOrNull() ?: 0f).coerceAtMost(0f)
    val range = (max - min).coerceAtLeast(0.01f)
    val animProgress by animateFloatAsState(1f, tween(1200, easing = FastOutSlowInEasing), label = "line")
    Canvas(modifier = modifier) {
        val padLeft = 48.dp.toPx(); val padBottom = 32.dp.toPx()
        val chartW = size.width - padLeft; val chartH = size.height - padBottom
        for (i in 0..4) {
            val y = i * chartH / 4f
            drawLine(Color.Gray.copy(alpha = 0.12f), Offset(padLeft, y), Offset(size.width, y), 1.dp.toPx())
        }
        series.forEachIndexed { sIdx, (_, data) ->
            if (data.size < 2) return@forEachIndexed
            val step = chartW / (data.size - 1); val color = palette.getOrElse(sIdx) { Color.Gray }
            val path = Path()
            data.forEachIndexed { i, v ->
                val x = padLeft + i * step; val y = chartH - ((v - min) / range) * chartH * animProgress
                if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            drawPath(path, color, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            val lx = padLeft + (data.size - 1) * step
            val ly = chartH - ((data.last() - min) / range) * chartH * animProgress
            drawCircle(color, 5.dp.toPx(), Offset(lx, ly))
        }
    }
}

/** Horizontal bar chart — ideal for cost-per-KM leaderboard. */
@Composable
fun TPBarChart(
    bars: List<Pair<String, Float>>,
    barColor: Color = Color(0xFF10B981),
    modifier: Modifier = Modifier
) {
    val max = bars.maxOfOrNull { it.second } ?: 1f
    val animProgress by animateFloatAsState(1f, tween(1000, easing = FastOutSlowInEasing), label = "bar")
    Canvas(modifier = modifier) {
        val barH = size.height / (bars.size * 1.5f); val gap = barH * 0.5f; val maxBarW = size.width
        bars.forEachIndexed { i, (_, value) ->
            val y = i * (barH + gap); val barW = (value / max) * maxBarW * animProgress
            drawRoundRect(barColor.copy(alpha = 0.10f), Offset(0f, y), Size(maxBarW, barH), CornerRadius(barH / 2))
            if (barW > 0f)
                drawRoundRect(Brush.horizontalGradient(listOf(barColor.copy(alpha = 0.8f), barColor)), Offset(0f, y), Size(barW, barH), CornerRadius(barH / 2))
        }
    }
}

/** Donut chart for fleet health summaries. */
@Composable
fun TPDonutChart(
    segments: List<Pair<String, Float>>,
    colors: List<Color> = listOf(Color(0xFF10B981), Color(0xFFF59E0B), Color(0xFFEF4444), Color(0xFF60A5FA)),
    modifier: Modifier = Modifier
) {
    val total = segments.sumOf { it.second.toDouble() }.toFloat().coerceAtLeast(0.01f)
    val animProgress by animateFloatAsState(1f, tween(1400, easing = FastOutSlowInEasing), label = "donut")
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val stroke = 28.dp.toPx(); val diameter = size.minDimension - stroke
            val topLeft = Offset((size.width - diameter) / 2, (size.height - diameter) / 2)
            val arcSize = Size(diameter, diameter); var startAngle = -90f
            segments.forEachIndexed { i, (_, v) ->
                val sweep = (v / total) * 360f * animProgress
                drawArc(colors.getOrElse(i) { Color.Gray }, startAngle, sweep, false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
                startAngle += sweep
            }
        }
    }
}
