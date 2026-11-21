/**
 * Inventory screens' user-facing error text.
 *
 * Same contract as `safeError.toUserMessage` (never a raw database message)
 * with one addition: a refusal the server WROTE for the user (segregation of
 * duties, missing stock permission, refused shortage, wrong state) and our own
 * client validation messages are shown as written. The inventory service layer
 * marks those with an `INV_*` code after checking the text is a plain sentence
 * (`inventoryRefusalText` in src/lib/api/inventory.js), so a generic
 * "Something went wrong" never hides "The approver cannot be the counter".
 *
 * Exported under the same name so the inventory components only change the
 * import path.
 */
import { toUserMessage as safeMessage } from '../safeError'

export function toUserMessage(err, fallback) {
  const code = typeof err?.code === 'string' ? err.code : ''
  if (code.startsWith('INV_') && typeof err.message === 'string' && err.message.trim()) return err.message.trim()
  return safeMessage(err, fallback)
}

export default toUserMessage
