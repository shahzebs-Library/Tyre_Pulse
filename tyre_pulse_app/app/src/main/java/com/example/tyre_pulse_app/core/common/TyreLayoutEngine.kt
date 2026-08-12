package com.example.tyre_pulse_app.core.common

data class TyreSlot(
    val id: String,
    val label: String,
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float
)

data class VehicleLayout(
    val name: String,
    val emoji: String,
    val viewH: Float,
    val bodyKey: String,
    val slots: List<TyreSlot>
)

object TyreLayoutEngine {

    /**
     * Exact coordinate port from Expo tyreDiagramLayouts.ts
     */
    fun buildLayout(vehicleType: String?, assetNo: String? = null): VehicleLayout {
        val type = resolveVehicleType(vehicleType, assetNo)
        
        return when (type) {
            "Tri-mixer" -> VehicleLayout("Tri-mixer", "🚛", 360f, "triMixer", listOf(
                TyreSlot("F1L", "LHF1", 29f, 24f, 22f, 38f),
                TyreSlot("F1R", "RHF1", 149f, 24f, 22f, 38f),
                TyreSlot("F2L", "LHF2", 29f, 76f, 22f, 38f),
                TyreSlot("F2R", "RHF2", 149f, 76f, 22f, 38f),
                TyreSlot("R1Lo", "LHCO", 14f, 170f, 19f, 35f),
                TyreSlot("R1Li", "LHCI", 35f, 170f, 19f, 35f),
                TyreSlot("R1Ri", "RHCI", 146f, 170f, 19f, 35f),
                TyreSlot("R1Ro", "RHCO", 167f, 170f, 19f, 35f),
                TyreSlot("R2Lo", "LHRO", 14f, 218f, 19f, 35f),
                TyreSlot("R2Li", "LHRI", 35f, 218f, 19f, 35f),
                TyreSlot("R2Ri", "RHRI", 146f, 218f, 19f, 35f),
                TyreSlot("R2Ro", "RHRO", 167f, 218f, 19f, 35f)
            ))
            "Canter" -> VehicleLayout("Canter", "🚚", 310f, "canter", listOf(
                TyreSlot("FL", "LHF1", 31f, 36f, 22f, 40f),
                TyreSlot("FR", "RHF1", 147f, 36f, 22f, 40f),
                TyreSlot("RLo", "LHRO", 16f, 170f, 20f, 38f),
                TyreSlot("RLi", "LHRI", 38f, 170f, 20f, 38f),
                TyreSlot("RRi", "RHRI", 142f, 170f, 20f, 38f),
                TyreSlot("RRo", "RHRO", 164f, 170f, 20f, 38f)
            ))
            "Wheel loader" -> VehicleLayout("Wheel loader", "🚜", 258f, "wheelLoader", listOf(
                TyreSlot("FL", "LHF1", 24f, 22f, 32f, 56f),
                TyreSlot("FR", "RHF1", 144f, 22f, 32f, 56f),
                TyreSlot("RL", "LHR1", 24f, 155f, 32f, 56f),
                TyreSlot("RR", "RHR1", 144f, 155f, 32f, 56f)
            ))
            "Concrete pump" -> VehicleLayout("Concrete pump", "🏗️", 375f, "concretePump", listOf(
                TyreSlot("F1L", "LHF1", 29f, 40f, 22f, 38f),
                TyreSlot("F1R", "RHF1", 149f, 40f, 22f, 38f),
                TyreSlot("F2L", "LHF2", 29f, 84f, 22f, 38f),
                TyreSlot("F2R", "RHF2", 149f, 84f, 22f, 38f),
                TyreSlot("F3L", "LHF3", 29f, 128f, 22f, 38f),
                TyreSlot("F3R", "RHF3", 149f, 128f, 22f, 38f),
                TyreSlot("R1Lo", "LHR1-O", 13f, 258f, 19f, 33f),
                TyreSlot("R1Li", "LHR1-I", 34f, 258f, 19f, 33f),
                TyreSlot("R1Ri", "RHR1-I", 147f, 258f, 19f, 33f),
                TyreSlot("R1Ro", "RHR1-O", 168f, 258f, 19f, 33f)
            ))
            else -> VehicleLayout("Pickup", "🛻", 320f, "pickup", listOf(
                TyreSlot("FL", "LHF1", 32f, 48f, 23f, 44f),
                TyreSlot("FR", "RHF1", 145f, 48f, 23f, 44f),
                TyreSlot("RL", "LHR1", 32f, 192f, 23f, 44f),
                TyreSlot("RR", "RHR1", 145f, 192f, 23f, 44f)
            ))
        }
    }

    private fun resolveVehicleType(vt: String?, assetNo: String?): String {
        val s = (vt ?: assetNo ?: "").lowercase()
        return when {
            s.contains("mixer") -> "Tri-mixer"
            s.contains("pump") -> "Concrete pump"
            s.contains("loader") -> "Wheel loader"
            s.contains("canter") -> "Canter"
            s.contains("bus") -> "Bus"
            else -> "Pickup"
        }
    }
}
