This is a production-grade field operations Android app.

Use:
- Kotlin
- Jetpack Compose
- Material 3
- ViewModel
- StateFlow
- Repository pattern
- Room for local persistence
- WorkManager for background sync
- Hilt for dependency injection

Rules:

1. Never hard-code Back to Home.
2. Back must follow the real navigation stack.
3. List screens must restore:
    - scroll position
    - search
    - filters
    - selected tab
    - sort
    - loaded pagination
4. Opening details and pressing Back must return to the exact previous list position.
5. Do not call APIs directly from Composables.
6. Every screen needs:
    - loading state
    - success state
    - empty state
    - error state
    - offline state where applicable
7. Preserve user-entered form data when navigating or when the app goes to background.
8. Avoid duplicate API actions from double taps.
9. Features must be modular.
10. Do not remove existing business fields or functionality unless explicitly instructed.