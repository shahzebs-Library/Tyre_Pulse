package com.example.tyre_pulse_app.core.authentication.data

import com.example.tyre_pulse_app.core.authentication.TokenManager
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.model.*
import com.example.tyre_pulse_app.core.network.api.AuthApi
import com.example.tyre_pulse_app.core.network.api.IdentifierRequest
import com.example.tyre_pulse_app.core.network.model.request.LoginRequest
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val authApi: AuthApi,
    private val tokenManager: TokenManager,
    private val workspaceManager: WorkspaceManager,
    private val userRepository: UserRepository
) {
    suspend fun login(identifier: String, password: String): Result<Unit> {
        return try {
            var email = identifier.trim()
            
            if (!email.contains("@")) {
                val resolved = authApi.resolveEmail(IdentifierRequest(email))
                if (resolved.isNullOrEmpty()) {
                    return Result.failure(Exception("No account found with that username or Employee ID."))
                }
                email = resolved
            }

            val response = authApi.login(LoginRequest(email, password))
            tokenManager.saveTokens(response.accessToken, response.refreshToken)
            
            // Fetch profile using PostgREST filter format: id=eq.<uuid>
            val profiles: List<Profile> = authApi.getProfile("eq.${response.user.id}")
            if (profiles.isNotEmpty()) {
                val profile = profiles.first()
                val defaultWorkspace = WorkspaceContext(
                    tenant = Tenant(profile.orgId ?: "00000000-0000-0000-0000-000000000001", "Organization"),
                    company = Company("c1", profile.orgId ?: "00000000-0000-0000-0000-000000000001", "Company"),
                    country = Country("sa", "c1", "Saudi Arabia", "SA", "SAR", "Asia/Riyadh"),
                    site = null
                )
                workspaceManager.setWorkspace(defaultWorkspace)

                val user = User(
                    id = profile.id,
                    name = profile.fullName ?: profile.username ?: "Unknown",
                    email = profile.email ?: response.user.email ?: "",
                    role = profile.role,
                    availableWorkspaces = listOf(defaultWorkspace) // Ideally fetched from DB
                )
                userRepository.setCurrentUser(user)
            }
            
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun logout() {
        tokenManager.clearTokens()
        workspaceManager.clearWorkspace()
        userRepository.clearCurrentUser()
    }
}
