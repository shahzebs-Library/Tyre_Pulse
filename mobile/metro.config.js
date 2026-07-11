// Sentry-wrapped Expo Metro config. getSentryExpoConfig extends the default
// Expo Metro config and emits the Debug IDs / source maps Sentry needs to
// symbolicate release stack traces. Behaves exactly like the default config
// when no Sentry DSN / auth token is configured.
const { getSentryExpoConfig } = require('@sentry/react-native/metro')

const config = getSentryExpoConfig(__dirname)

module.exports = config
