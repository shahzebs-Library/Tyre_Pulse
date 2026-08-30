# Password recovery: verified email and mobile

## User flow

1. While signed in, open **Settings → Password recovery**.
2. Add an email address and/or an E.164 mobile number (for example `+966501234567`).
3. Enter the six-digit code sent to that contact. An unverified contact cannot recover the account.
4. From **Forgot password**, select Email or Mobile SMS, enter the verified contact and then the six-digit code.
5. TyrePulse creates a one-use Supabase recovery session. After the password is changed, all existing sessions are revoked.

The public request response is deliberately identical for existing, unknown, unverified, locked and delivery-failed contacts. This prevents the screen from becoming an account-enumeration API.

## Deployment

Apply `supabase/migrations/20260830134159_password_recovery_channels.sql`, then deploy the function:

```powershell
npx supabase functions deploy account-recovery
```

Set server-only secrets. Never use `VITE_` names for these values.

```powershell
npx supabase secrets set RECOVERY_HMAC_SECRET="<at-least-32-random-characters>"
npx supabase secrets set APP_URL="https://your-production-domain.example"
npx supabase secrets set RESEND_API_KEY="re_..."
npx supabase secrets set RECOVERY_EMAIL_FROM="TyrePulse Security <security@your-verified-domain.example>"
npx supabase secrets set TWILIO_ACCOUNT_SID="AC..."
npx supabase secrets set TWILIO_AUTH_TOKEN="..."
npx supabase secrets set TWILIO_FROM_NUMBER="+1..."
```

Add every production/staging origin to `ALLOWED_ORIGINS`. Configure and verify the sending domain in Resend. Configure a Twilio sender that is permitted to deliver to every supported country; Saudi and other jurisdictions may require sender registration.

## Mandatory production checks

- Verify email delivery, bounce, complaint and suppression webhooks.
- Verify SMS delivery/failure callbacks, regional sender registration and spend limits.
- Keep CAPTCHA/WAF protection in front of the public function in addition to its five-request/15-minute application limit.
- Test unknown, unverified, locked and valid contacts return the same request response.
- Test a code expires after ten minutes, is refused after five attempts and cannot be consumed twice.
- Test changing a password revokes refresh tokens on other devices.
- Test two users cannot verify the same recovery email or mobile number.
- Alert on delivery-provider failures and abnormal recovery volume without logging raw email addresses, mobile numbers, codes or action links.

## Existing accounts

Most historical TyrePulse accounts have synthetic `@users.tyrepulse.app` Auth emails. The old Supabase recovery-email call could not deliver to them. They must sign in once and verify at least one recovery contact in Settings. If already locked out, an authorized administrator must use the audited **Set Password** action once; the user should then sign in and enroll recovery contacts immediately.

Mobile-number recovery should be paired with MFA because mobile numbers can be recycled. Recovery contacts are intentionally separate from authorization data and must never be used in RLS policies.
