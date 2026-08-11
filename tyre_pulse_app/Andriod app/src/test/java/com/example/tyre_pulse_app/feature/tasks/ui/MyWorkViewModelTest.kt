package com.example.tyre_pulse_app.feature.tasks.ui

import androidx.lifecycle.SavedStateHandle
import app.cash.turbine.test
import com.example.tyre_pulse_app.core.authentication.UserViewModel
import com.example.tyre_pulse_app.core.data.repository.TaskRepository
import com.example.tyre_pulse_app.core.model.User
import com.example.tyre_pulse_app.core.testing.rules.MainDispatcherRule
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

@ExperimentalCoroutinesApi
class MyWorkViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val taskRepository = mockk<TaskRepository>()
    private val userViewModel = mockk<UserViewModel>()

    @Test
    fun `initial state loads tasks for current user`() = runTest {
        val user = User(id = "user-1", name = "Test User", email = "test@test.com")
        val userFlow = MutableStateFlow<User?>(user)
        every { userViewModel.currentUser } returns userFlow
        every { taskRepository.getTasks(any(), any()) } returns flowOf(emptyList())

        val viewModel = MyWorkViewModel(taskRepository, userViewModel, SavedStateHandle())

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals(false, state.isLoading)
        }
    }
}
