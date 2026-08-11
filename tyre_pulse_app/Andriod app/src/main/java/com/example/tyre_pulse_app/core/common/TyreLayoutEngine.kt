package com.example.tyre_pulse_app.core.common

enum class TyreSlotKind { STEER, DRIVE, LIFT, TRAILER, SPARE }
enum class TyreSide { L, R, C }
enum class VehicleBodyClass { CAR, TRUCK, TRAILER }

data class TyreSlot(
    val id: String,
    val label: String,
    val kind: TyreSlotKind,
    val side: TyreSide,
    val axle: Int,
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
    val horizontal: Boolean = false
)

data class TyreDiagramLayout(
    val viewH: Float,
    val bodyClass: VehicleBodyClass,
    val chassisTop: Float,
    val chassisBot: Float,
    val axleYs: List<Float>,
    val slots: List<TyreSlot>,
    val hasSpare: Boolean,
    val resolvedType: String
)

object TyreLayoutEngine {
    // Geometry constants (matching mobile/lib/tyreLayout.ts)
    private const val LEFT_SINGLE = 45f
    private const val RIGHT_SINGLE = 155f
    private const val DUAL_LEFT_OUTER = 28f
    private const val DUAL_LEFT_INNER = 50f
    private const val DUAL_RIGHT_INNER = 150f
    private const val DUAL_RIGHT_OUTER = 172f
    private const val TRAILER_LEFT = 40f
    private const val TRAILER_RIGHT = 160f

    private const val STEER_W = 22f
    private const val STEER_H = 38f
    private const val SINGLE_W = 22f
    private const val SINGLE_H = 36f
    private const val DUAL_W = 19f
    private const val DUAL_H = 35f
    private const val LIFT_W = 20f
    private const val LIFT_H = 34f
    private const val TRAILER_W = 20f
    private const val TRAILER_H = 35f
    private const val SPARE_W = 38f
    private const val SPARE_H = 12f

    private const val TOP_Y = 26f
    private const val STEER_GAP = 50f
    private const val MID_GAP = 34f
    private const val DRIVE_GAP = 46f
    private const val TRAILER_TOP_Y = 48f
    private const val TRAILER_GAP = 52f

    data class ParsedPos(
        val id: String,
        val kind: TyreSlotKind,
        val side: TyreSide,
        val ordinal: Int
    )

    fun parsePosition(id: String): ParsedPos {
        val u = id.uppercase().replace(Regex("[\\s\\-_]+"), "")
        
        if (u == "SP" || u.contains("SPARE")) return ParsedPos(id, TyreSlotKind.SPARE, TyreSide.C, 0)
        
        u.match("^AXLE([LR])(\\d+)$")?.let {
            return ParsedPos(id, TyreSlotKind.TRAILER, TyreSide.valueOf(it.groupValues[1]), it.groupValues[2].toInt())
        }
        
        u.match("^S([LR])(\\d*)$")?.let {
            return ParsedPos(id, TyreSlotKind.LIFT, TyreSide.valueOf(it.groupValues[1]), if (it.groupValues[2].isEmpty()) 1 else it.groupValues[2].toInt())
        }
        
        u.match("^F([LR])(\\d*)$")?.let {
            return ParsedPos(id, TyreSlotKind.STEER, TyreSide.valueOf(it.groupValues[1]), if (it.groupValues[2].isEmpty()) 1 else it.groupValues[2].toInt())
        }
        
        u.match("^R([LR])(\\d*)$")?.let {
            return ParsedPos(id, TyreSlotKind.DRIVE, TyreSide.valueOf(it.groupValues[1]), if (it.groupValues[2].isEmpty()) 1 else it.groupValues[2].toInt())
        }
        
        return ParsedPos(id, TyreSlotKind.DRIVE, TyreSide.L, 99)
    }

    private fun String.match(regex: String) = Regex(regex).find(this)

    fun buildLayout(vehicleType: String?, positions: List<String>): TyreDiagramLayout {
        val parsed = positions.map { parsePosition(it) }
        
        val steer = parsed.filter { it.kind == TyreSlotKind.STEER }
        val drive = parsed.filter { it.kind == TyreSlotKind.DRIVE }
        val lift = parsed.filter { it.kind == TyreSlotKind.LIFT }
        val trailer = parsed.filter { it.kind == TyreSlotKind.TRAILER }
        val spares = parsed.filter { it.kind == TyreSlotKind.SPARE }

        val rows = mutableListOf<AxleRow>()

        // 1. Steer
        val steerAxleNos = steer.map { it.ordinal }.distinct().sorted()
        steerAxleNos.forEach { no ->
            val wheels = mutableListOf<WheelSpec>()
            steer.find { it.side == TyreSide.L && it.ordinal == no }?.let { 
                wheels.add(WheelSpec(it, LEFT_SINGLE - STEER_W / 2, STEER_W, STEER_H)) 
            }
            steer.find { it.side == TyreSide.R && it.ordinal == no }?.let { 
                wheels.add(WheelSpec(it, RIGHT_SINGLE - STEER_W / 2, STEER_W, STEER_H)) 
            }
            rows.add(AxleRow(TyreSlotKind.STEER, wheels, STEER_H))
        }

        // 2. Drive
        val driveL = drive.filter { it.side == TyreSide.L }.sortedBy { it.ordinal }
        val driveR = drive.filter { it.side == TyreSide.R }.sortedBy { it.ordinal }
        val leftPairs = driveL.chunked(2)
        val rightPairs = driveR.chunked(2)
        val driveAxleCount = maxOf(leftPairs.size, rightPairs.size)
        
        for (i in 0 until driveAxleCount) {
            val lPair = leftPairs.getOrNull(i) ?: emptyList()
            val rPair = rightPairs.getOrNull(i) ?: emptyList()
            val dual = lPair.size > 1 || rPair.size > 1
            val wheels = mutableListOf<WheelSpec>()
            
            if (dual) {
                lPair.getOrNull(0)?.let { wheels.add(WheelSpec(it, DUAL_LEFT_OUTER - DUAL_W / 2, DUAL_W, DUAL_H)) }
                lPair.getOrNull(1)?.let { wheels.add(WheelSpec(it, DUAL_LEFT_INNER - DUAL_W / 2, DUAL_W, DUAL_H)) }
                rPair.getOrNull(0)?.let { wheels.add(WheelSpec(it, DUAL_RIGHT_INNER - DUAL_W / 2, DUAL_W, DUAL_H)) }
                rPair.getOrNull(1)?.let { wheels.add(WheelSpec(it, DUAL_RIGHT_OUTER - DUAL_W / 2, DUAL_W, DUAL_H)) }
            } else {
                lPair.getOrNull(0)?.let { wheels.add(WheelSpec(it, LEFT_SINGLE - SINGLE_W / 2, SINGLE_W, SINGLE_H)) }
                rPair.getOrNull(0)?.let { wheels.add(WheelSpec(it, RIGHT_SINGLE - SINGLE_W / 2, SINGLE_W, SINGLE_H)) }
            }
            rows.add(AxleRow(TyreSlotKind.DRIVE, wheels, if (dual) DUAL_H else SINGLE_H))
        }

        // 3. Lift
        val liftAxleNos = lift.map { it.ordinal }.distinct().sorted()
        liftAxleNos.forEach { no ->
            val wheels = mutableListOf<WheelSpec>()
            lift.find { it.side == TyreSide.L && it.ordinal == no }?.let { 
                wheels.add(WheelSpec(it, LEFT_SINGLE - LIFT_W / 2, LIFT_W, LIFT_H)) 
            }
            lift.find { it.side == TyreSide.R && it.ordinal == no }?.let { 
                wheels.add(WheelSpec(it, RIGHT_SINGLE - LIFT_W / 2, LIFT_W, LIFT_H)) 
            }
            rows.add(AxleRow(TyreSlotKind.LIFT, wheels, LIFT_H))
        }

        // 4. Trailer
        val trailerAxleNos = trailer.map { it.ordinal }.distinct().sorted()
        trailerAxleNos.forEach { no ->
            val wheels = mutableListOf<WheelSpec>()
            trailer.find { it.side == TyreSide.L && it.ordinal == no }?.let { 
                wheels.add(WheelSpec(it, TRAILER_LEFT - TRAILER_W / 2, TRAILER_W, TRAILER_H)) 
            }
            trailer.find { it.side == TyreSide.R && it.ordinal == no }?.let { 
                wheels.add(WheelSpec(it, TRAILER_RIGHT - TRAILER_W / 2, TRAILER_W, TRAILER_H)) 
            }
            rows.add(AxleRow(TyreSlotKind.TRAILER, wheels, TRAILER_H))
        }

        val runningCount = parsed.size - spares.size
        val hasSteer = steerAxleNos.isNotEmpty()
        val isTrailerOnly = !hasSteer && trailerAxleNos.isNotEmpty() && driveAxleCount == 0
        
        val bodyClass = when {
            isTrailerOnly -> VehicleBodyClass.TRAILER
            hasSteer && runningCount <= 4 && rows.all { it.kind != TyreSlotKind.DRIVE || it.wheels.all { w -> w.w == SINGLE_W } } -> VehicleBodyClass.CAR
            else -> VehicleBodyClass.TRUCK
        }

        val slots = mutableListOf<TyreSlot>()
        val axleYs = mutableListOf<Float>()
        var cursor = if (bodyClass == VehicleBodyClass.TRAILER) TRAILER_TOP_Y else TOP_Y
        var prevKind: TyreSlotKind? = null
        
        rows.forEachIndexed { index, row ->
            if (prevKind == TyreSlotKind.STEER && row.kind != TyreSlotKind.STEER) cursor += MID_GAP
            val yc = cursor + row.h / 2
            axleYs.add(yc)
            row.wheels.forEach { wh ->
                slots.add(TyreSlot(
                    id = wh.p.id,
                    label = wh.p.id.uppercase(),
                    kind = wh.p.kind,
                    side = wh.p.side,
                    axle = index,
                    x = wh.x,
                    y = yc - wh.h / 2,
                    w = wh.w,
                    h = wh.h
                ))
            }
            val gap = when(row.kind) {
                TyreSlotKind.STEER -> STEER_GAP
                else -> if (bodyClass == VehicleBodyClass.TRAILER) TRAILER_GAP else DRIVE_GAP
            }
            cursor += gap
            prevKind = row.kind
        }

        val firstYc = axleYs.firstOrNull() ?: (TOP_Y + 20f)
        val lastYc = axleYs.lastOrNull() ?: firstYc
        val lastRowH = if (rows.isNotEmpty()) rows.last().h else SINGLE_H
        val chassisTop = if (bodyClass == VehicleBodyClass.TRAILER) maxOf(8f, firstYc - 30f) else maxOf(8f, firstYc - 22f)
        val chassisBot = lastYc + lastRowH / 2 + 8f

        val hasSpare = spares.isNotEmpty()
        var spareBottom = chassisBot
        if (hasSpare) {
            val totalW = spares.size * SPARE_W + maxOf(0, spares.size - 1) * 8f
            var sx = 100f - totalW / 2
            val sy = chassisBot + 16f
            spares.forEach { sp ->
                slots.add(TyreSlot(
                    id = sp.id,
                    label = "SP",
                    kind = TyreSlotKind.SPARE,
                    side = TyreSide.C,
                    axle = -1,
                    x = sx,
                    y = sy,
                    w = SPARE_W,
                    h = SPARE_H,
                    horizontal = true
                ))
                sx += SPARE_W + 8f
            }
            spareBottom = sy + SPARE_H
        }

        return TyreDiagramLayout(
            viewH = spareBottom + 12f,
            bodyClass = bodyClass,
            chassisTop = chassisTop,
            chassisBot = chassisBot,
            axleYs = axleYs,
            slots = slots,
            hasSpare = hasSpare,
            resolvedType = vehicleType ?: "Vehicle"
        )
    }

    private data class WheelSpec(val p: ParsedPos, val x: Float, val w: Float, val h: Float)
    private data class AxleRow(val kind: TyreSlotKind, val wheels: List<WheelSpec>, val h: Float)
}
