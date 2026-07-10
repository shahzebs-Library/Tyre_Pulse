// Bootstrap: start the HTTP server and shut Chromium down cleanly on exit.
import { createServer } from './server.js'
import { closeBrowser } from './renderer.js'

const port = Number(process.env.PORT || 8080)
const app = createServer()
const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[report-engine] listening on :${port}`)
})

async function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[report-engine] ${signal} received, shutting down`)
  server.close()
  await closeBrowser()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
