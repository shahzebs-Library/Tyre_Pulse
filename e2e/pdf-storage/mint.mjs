// Mint a long-lived HS256 key for a role (anon or service_role) from the per-run secret. Test harness only.
import { sign } from './jwt.mjs'
console.log(sign({ role: process.argv[2], iss: 'tyrepulse-e2e', iat: 1700000000, exp: 4102444800 }, process.env.E2E_JWT_SECRET))
