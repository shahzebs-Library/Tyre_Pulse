// Prints an anon JWT for this run. The secret comes from the environment and is never written to the repository.
import { sign } from './jwt.mjs'
const secret = process.env.E2E_JWT_SECRET
if (!secret) { console.error('E2E_JWT_SECRET is required'); process.exit(1) }
const now = Math.floor(Date.now() / 1000)
process.stdout.write(sign({ role: 'anon', iss: 'tyrepulse-e2e', iat: now, exp: now + 60 * 60 * 24 * 30 }, secret))
