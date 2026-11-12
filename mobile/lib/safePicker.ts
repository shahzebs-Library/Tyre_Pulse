/**
 * safePicker - launch the Expo image picker without letting a native rejection
 * escape as an unhandled promise rejection.
 *
 * Some Android devices (notably Xiaomi / MIUI, Sentry device.class 2) reject
 * `launchCameraAsync` from inside expo-image-picker with
 *   java.lang.IllegalArgumentException: Uri lacks 'file' scheme:
 *   content://<app>.ImagePickerFileProvider/cached_expo_files/ImagePicker/<id>.jpeg
 * a FileProvider / URI-scheme mismatch inside the module itself. With the raw
 * call that rejection reaches the global onunhandledrejection handler (logged as
 * an app error) and the capture silently fails.
 *
 * These wrappers catch it, record it to Sentry as a HANDLED exception (so the
 * device issue stays visible without being a crash), run an optional caller
 * onError, and report a plain cancel so the caller's existing "nothing captured"
 * branch runs. The underlying native bug is only truly removed by an
 * expo-image-picker bump in a new build; this contains it in the current one.
 */
import * as ImagePicker from 'expo-image-picker'
import { Sentry, sentryEnabled } from './sentry'

type Options = ImagePicker.ImagePickerOptions
export type PickerResult = ImagePicker.ImagePickerResult

const CANCELED: PickerResult = { canceled: true, assets: null }

function report(err: unknown, source: string) {
  if (!sentryEnabled) return
  try {
    Sentry.captureException(err, { tags: { picker: source }, level: 'warning' })
  } catch {
    // Never let logging throw from a camera button.
  }
}

/** launchCameraAsync, guarded. Returns a cancel on any native failure. */
export async function safeLaunchCamera(opts: Options, onError?: () => void): Promise<PickerResult> {
  try {
    return await ImagePicker.launchCameraAsync(opts)
  } catch (err) {
    report(err, 'launchCameraAsync')
    onError?.()
    return CANCELED
  }
}

/** launchImageLibraryAsync, guarded. Returns a cancel on any native failure. */
export async function safeLaunchLibrary(opts: Options, onError?: () => void): Promise<PickerResult> {
  try {
    return await ImagePicker.launchImageLibraryAsync(opts)
  } catch (err) {
    report(err, 'launchImageLibraryAsync')
    onError?.()
    return CANCELED
  }
}
