// Module resolve hook for `npm test`. The app's source uses extensionless relative
// imports (e.g. `import { amortize } from './amortization'`) which Vite resolves but
// Node's native ESM loader does not. This hook appends `.ts` (then `/index.ts`) for
// relative specifiers that lack an extension and actually exist on disk, so the
// dependency-free Node test runner can import the real engine modules unchanged.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HAS_EXT = /\.[cm]?[jt]sx?$/i

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !HAS_EXT.test(specifier) && context.parentURL) {
    for (const ext of ['.ts', '/index.ts']) {
      const candidate = new URL(specifier + ext, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) return nextResolve(specifier + ext, context)
    }
  }
  return nextResolve(specifier, context)
}
