// Registers the extensionless-TS resolve hook for the Node test runner (loaded via
// `node --import ./scripts/register-ts.mjs`). See ts-resolve-hook.mjs.
import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
