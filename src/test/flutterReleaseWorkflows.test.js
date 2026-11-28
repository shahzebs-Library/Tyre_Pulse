// Regression guard for the Flutter Android release pipeline.
//
// Two real defects shipped before this guard existed:
//  1. flutter-release-play.yml used unpinned Flutter stable, which moved to a
//     release needing a newer AGP than android/settings.gradle.kts pins.
//  2. It overwrote the COMMITTED MainActivity.kt (biometric MethodChannel +
//     push channel) with the empty `flutter create` scaffold, so Play build
//     0.1.1+7 shipped without biometric unlock or the "alerts" channel.
// Both workflows now share .github/actions/flutter-android-build. These tests
// fail if either drifts back.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n')
const FLUTTER_PIN = '3.47.2'
const ACTION = '.github/actions/flutter-android-build/action.yml'

describe('Flutter Android release pipeline', () => {
  it('every flutter-action use pins the verified Flutter version', () => {
    const files = [
      ACTION,
      ...readdirSync(resolve(root, '.github/workflows'))
        .filter((f) => /^flutter-.*\.ya?ml$/.test(f))
        .map((f) => `.github/workflows/${f}`),
    ]
    for (const f of files) {
      const text = read(f)
      const uses = text.split('subosito/flutter-action').length - 1
      const pins = (text.match(new RegExp(`flutter-version:\\s*${FLUTTER_PIN.replace(/\./g, '\\.')}`, 'g')) || []).length
      expect(pins, `${f} must pin flutter-version ${FLUTTER_PIN} on every flutter-action`).toBe(uses)
    }
  })

  it('both Android release workflows build through the shared action', () => {
    for (const f of ['.github/workflows/flutter-release-play.yml', '.github/workflows/flutter-internal-apk.yml']) {
      const text = read(f)
      const code = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
      expect(text, f).toContain('uses: ./.github/actions/flutter-android-build')
      expect(code, `${f} must not run flutter create itself`).not.toMatch(/flutter create/)
      expect(code, `${f} must not touch MainActivity`).not.toMatch(/MainActivity/)
    }
  })

  it('the shared action keeps the committed MainActivity and never overwrites it', () => {
    const text = read(ACTION)
    expect(text).toContain('grep -q \'MethodChannel\'')
    expect(text).toContain('createNotificationChannel')
    expect(text).not.toMatch(/sed .*tyre_pulse.*> "\$new_kt_dir/)
    expect(text).toContain('--dart-define=APP_ENV=production')
    expect(text).toContain('applicationId = "com.shahzebrahman.tyrepulse"')
  })

  it('the committed MainActivity carries the biometric and push channels', () => {
    const text = read('tyre_pulse_flutter/android/app/src/main/kotlin/com/shahzebrahman/tyrepulse/MainActivity.kt')
    expect(text).toMatch(/^package com\.shahzebrahman\.tyrepulse$/m)
    expect(text).toContain('MethodChannel')
    expect(text).toContain('com.shahzebrahman.tyrepulse/device_security')
    expect(text).toContain('createNotificationChannel')
  })

  it('the Play upload only happens when requested; production needs the typed confirmation', () => {
    const text = read('.github/workflows/flutter-release-play.yml')
    expect(text).toMatch(/upload_to_play:[\s\S]*?default: false/)
    expect(text).toMatch(/play_track:[\s\S]*?options: \[alpha, production\][\s\S]*?default: alpha/)
    expect(text).toContain('[ "$PLAY_TRACK" = "production" ] && [ "$CONFIRM" != "PRODUCTION" ]')
    const publish = text.slice(text.indexOf('r0adkll/upload-google-play'))
    const block = text.slice(text.lastIndexOf('- name:', text.indexOf('r0adkll/upload-google-play')))
    expect(block).toContain('if: ${{ inputs.upload_to_play }}')
    expect(publish).toMatch(/^ {10}track: \$\{\{ inputs\.play_track \}\}$/m)
    expect(publish).toMatch(/^ {10}packageName: com\.shahzebrahman\.tyrepulse$/m)
    expect(text).not.toMatch(/packageName: com\.shahzebrahman\.tyrepulseinspector/)
  })
})

describe('Flutter iOS TestFlight pipeline', () => {
  const WF = '.github/workflows/flutter-release-ios.yml'
  const code = () => read(WF).split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

  it('stays workflow_dispatch only', () => {
    const text = code()
    const on = text.slice(text.indexOf('\non:'), text.indexOf('\npermissions:'))
    expect(on).toContain('workflow_dispatch')
    expect(on).not.toMatch(/\b(push|pull_request|schedule):/)
  })

  it('signs manually with per-run API material, never cloud/automatic signing', () => {
    const text = code()
    expect(text).toContain('ios/ci/asc_signing.py setup')
    expect(text).toContain('<key>signingStyle</key><string>manual</string>')
    expect(text).not.toContain('-allowProvisioningUpdates')
    expect(text).not.toContain('CODE_SIGNING_ALLOWED=NO')
    expect(text).toContain('PROVISIONING_PROFILE_SPECIFIER')
  })

  it('always revokes the per-run certificate/profile and checks the team id', () => {
    const text = code()
    const cleanup = text.slice(text.lastIndexOf('- name:', text.indexOf('asc_signing.py cleanup')))
    expect(cleanup).toMatch(/if: always\(\)/)
    expect(cleanup).toContain('security delete-keychain')
    expect(text).toMatch(/APPLE_TEAM_ID[\s\S]*?"\$TEAM" != "\$api_team"/)
  })
})
