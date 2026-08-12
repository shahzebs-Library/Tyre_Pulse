package com.example.tyre_pulse_app.core.authentication.data

import com.example.tyre_pulse_app.core.model.User
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserRepository @Inject constructor() {
    // This will eventually fetch from API/Local DB
    fun getCurrentUser(): Flow<User?> {
        return flowOf(
            User(
                id = "1",
                name = "Lead Architect",
                email = "architect@tyrepulse.com",
                role = "ADMIN",
                availableWorkspaces = emptyList() // Mocking for now
            )
        )
    }
}
