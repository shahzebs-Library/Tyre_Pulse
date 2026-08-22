# TYRE PULSE NATIVE ANDROID

This folder contains the new production native Android application: `tyre_pulse_app`

## Repository boundaries
The existing `mobile` folder elsewhere in the repository is READ ONLY. Never modify anything under `mobile`. You may inspect it for workflows, layouts, and business logic.

## Mandatory project documentation
Before making changes, read the relevant files under `docs/`:
- `docs/ENTERPRISE_ANDROID.md`
- `docs/ARCHITECTURE.md`
- `docs/NAVIGATION_CONTRACT.md`
- `docs/UI_UX_CONTRACT.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/NEXT_WORK.md`

## Continuation rule
Never restart completed implementation blindly. 
1. Read `docs/IMPLEMENTATION_STATUS.md`.
2. Read `docs/NEXT_WORK.md`.
3. Inspect current implementation.
4. Continue missing or broken work only.

## Source-of-truth priority
1. Existing backend/business logic
2. Existing web implementation
3. Existing `mobile` implementation
4. Current native Android implementation

## Multi-tenant requirement
Support Tenant -> Company -> Country -> Project/Site isolation. Never assume a single global role or scope.

## CI/CD Pipeline
There is already a build pipeline configured in GitHub. Do not attempt to trigger local builds for deployment or pipeline-related tasks unless explicitly requested for local testing.
