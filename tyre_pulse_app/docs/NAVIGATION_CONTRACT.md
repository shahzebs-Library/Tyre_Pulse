# NAVIGATION CONTRACT

## Core Rules
- **Non-Linear Back**: `Back` must return through the actual history, not just jump to Home.
- **State Preservation**: Preserve scroll, search, and filter states when navigating back.
- **Role Adaptive**: Navigation structure (Tabs/Drawers) must change based on real backend permissions.

## Pathing Examples
- Search -> Asset -> Inspection. `Back` moves from Inspection -> Asset -> Search.
- Deep Links: Notification -> Work Order. `Back` moves from Work Order -> Workshop Hub -> Home.
