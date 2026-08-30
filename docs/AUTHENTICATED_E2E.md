# Authenticated browser verification

The production E2E gate signs in through the real login page. It never creates a user, embeds a token, bypasses route guards, or stores credentials in the repository.

## Local smoke test

Start a production preview, then run the browser check in another terminal:

```powershell
npm run build
npm run preview -- --host 127.0.0.1
npm run test:e2e
```

Without credentials this verifies only the public login surface and reports authenticated journeys as skipped.

## Required production gate

Provision a dedicated, approved, least-privilege test user and a seeded asset that user is permitted to view. Supply secrets through the CI secret store, never through a committed `.env` file:

```powershell
$env:E2E_BASE_URL = 'https://staging.example.com'
$env:E2E_USER_IDENTIFIER = '<dedicated test user email>'
$env:E2E_USER_PASSWORD = '<secret from CI vault>'
$env:E2E_ASSET_NO = '<seeded test asset>'
npm run test:e2e:required
```

`test:e2e:required` exits with code 2 if credentials are absent. `E2E_ASSET_NO` is optional locally; set it in CI to exercise Asset Detail and Full History against seeded tenant-scoped data.

The test account must not be a super-admin. Give it only the module and country/site permissions required by these journeys. Rotate its password using the same policy as other machine-managed test identities.
