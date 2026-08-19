package com.example.tyre_pulse_app.feature.scan.data

import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.Tyre

sealed interface ScanResolution {
    data class Vehicle(val code: String, val raw: String, val vehicle: Asset) : ScanResolution
    data class TyreCode(val code: String, val raw: String, val tyre: Tyre) : ScanResolution
    data class Unknown(val code: String, val raw: String) : ScanResolution
    object None : ScanResolution
}
