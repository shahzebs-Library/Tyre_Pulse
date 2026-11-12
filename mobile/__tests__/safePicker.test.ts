/**
 * safePicker contract. A native expo-image-picker rejection (the Xiaomi
 * "Uri lacks 'file' scheme" FileProvider bug) must NOT escape as an unhandled
 * promise rejection: it is caught, logged to Sentry as HANDLED, surfaced via the
 * caller's onError, and reported as a cancel so the "nothing captured" branch runs.
 */
import { safeLaunchCamera, safeLaunchLibrary } from '../lib/safePicker'
import * as ImagePicker from 'expo-image-picker'
import { Sentry } from '../lib/sentry'

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))
jest.mock('../lib/sentry', () => ({
  Sentry: { captureException: jest.fn() },
  sentryEnabled: true,
}))

const camera = ImagePicker.launchCameraAsync as unknown as jest.Mock
const library = ImagePicker.launchImageLibraryAsync as unknown as jest.Mock
const capture = Sentry.captureException as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('safePicker', () => {
  it('passes the native result straight through on success', async () => {
    const ok = { canceled: false, assets: [{ uri: 'file:///a.jpg' }] }
    camera.mockResolvedValue(ok)
    await expect(safeLaunchCamera({})).resolves.toBe(ok)
    expect(capture).not.toHaveBeenCalled()
  })

  it('turns a native camera rejection into a logged, handled cancel + onError', async () => {
    camera.mockRejectedValue(new Error("Uri lacks 'file' scheme: content://.../ImagePicker/x.jpeg"))
    const onError = jest.fn()
    const r = await safeLaunchCamera({}, onError)
    expect(r.canceled).toBe(true)
    expect(r.assets).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0][1]).toMatchObject({ tags: { picker: 'launchCameraAsync' }, level: 'warning' })
  })

  it('guards the library picker the same way', async () => {
    library.mockRejectedValue(new Error('boom'))
    const r = await safeLaunchLibrary({})
    expect(r.canceled).toBe(true)
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('never throws even if Sentry logging itself throws', async () => {
    camera.mockRejectedValue(new Error('x'))
    capture.mockImplementation(() => { throw new Error('sentry down') })
    await expect(safeLaunchCamera({})).resolves.toMatchObject({ canceled: true })
  })
})
