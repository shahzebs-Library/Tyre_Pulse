package com.example.tyre_pulse_app.core.common

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

enum class ModuleStatus { ACTIVE, MAINTENANCE, DISABLED }

/**
 * Agent 28: Global Module Control.
 * Linked to the backend Admin Console to enable/disable features on the fly.
 */
@Singleton
class ModuleRegistry @Inject constructor() {
    private val _statusMap = MutableStateFlow<Map<String, ModuleStatus>>(emptyMap())
    val statusMap: StateFlow<Map<String, ModuleStatus>> = _statusMap

    fun getStatus(moduleId: String): ModuleStatus {
        return _statusMap.value[moduleId] ?: ModuleStatus.ACTIVE
    }

    fun setStatus(moduleId: String, status: ModuleStatus) {
        val current = _statusMap.value.toMutableMap()
        current[moduleId] = status
        _statusMap.value = current
    }
}
