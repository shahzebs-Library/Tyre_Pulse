import { createServer } from 'vite'
const server = await createServer({ server: { host: '127.0.0.1', port: 5182, strictPort: true,
  watch: { ignored: ['**/tyre_pulse_flutter/**', '**/mobile/**', '**/tyre_pulse_app/**', '**/audit/**', '**/supabase/**'] },
} })
await server.listen()
server.printUrls()
