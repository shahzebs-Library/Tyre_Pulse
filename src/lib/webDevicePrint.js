/**
 * Browser hardware for admins: send raw label commands to a USB thermal
 * printer (WebUSB) or a serial / Bluetooth-serial printer (Web Serial).
 * Chrome and Edge on desktop support both; other browsers do not, and the
 * caller falls back to the PDF sheet. Every function asks the browser's own
 * device picker, so a page can never reach a device the user did not choose.
 */

export function printerSupport(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  return { usb: !!nav?.usb?.requestDevice, serial: !!nav?.serial?.requestPort }
}

// Zebra, Honeywell, TSC, Xprinter-class vendors, plus any device of the
// USB printer class (7). The picker still lists only what the user plugged in.
const USB_FILTERS = [{ vendorId: 0x0a5f }, { vendorId: 0x0c2e }, { vendorId: 0x1203 }, { vendorId: 0x0483 }, { classCode: 7 }]

export async function sendToUsbPrinter(data, { nav = navigator, chunk = 16384 } = {}) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const device = await nav.usb.requestDevice({ filters: USB_FILTERS })
  await device.open()
  try {
    if (device.configuration === null) await device.selectConfiguration(1)
    const iface = device.configuration.interfaces.find((i) =>
      i.alternate.endpoints.some((e) => e.direction === 'out' && e.type === 'bulk'))
    if (!iface) throw new Error('printer_no_output')
    await device.claimInterface(iface.interfaceNumber)
    const ep = iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
    for (let i = 0; i < bytes.length; i += chunk) {
      await device.transferOut(ep.endpointNumber, bytes.slice(i, i + chunk))
    }
    await device.releaseInterface(iface.interfaceNumber)
  } finally {
    await device.close()
  }
  return bytes.length
}

export async function sendToSerialPrinter(data, { nav = navigator, baudRate = 9600 } = {}) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const port = await nav.serial.requestPort()
  await port.open({ baudRate })
  try {
    const writer = port.writable.getWriter()
    try { await writer.write(bytes) } finally { writer.releaseLock() }
  } finally {
    await port.close()
  }
  return bytes.length
}
