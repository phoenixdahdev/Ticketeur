import { registerHooks } from 'node:module'

// Lets `node --test` load this package's TypeScript sources as they are
// written.
//
// Node runs .ts files natively (type stripping), but its ESM resolver still
// wants a file extension on every relative specifier, and this repository is
// written for a bundler: `import { newId } from './ids'`, `from './schema'`
// for a directory with an index. Rather than rewrite every import in the
// repository to suit the test runner, or pull in a transpiler and a config
// file for it, this adds the four shapes a bundler would have tried.
//
// It only ever runs under `node --test` (see the `test` script in
// package.json); nothing in a build or a deploy loads it.

type NextResolve = (specifier: string, context: unknown) => unknown

// The two ways Node says "that specifier did not land on a file". Anything
// else — a bad exports map, a package that genuinely is not installed — is
// rethrown, so a real resolution bug is not papered over by a retry.
const RETRYABLE = new Set([
  'ERR_MODULE_NOT_FOUND',
  'ERR_UNSUPPORTED_DIR_IMPORT',
])

const SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js', '/index.js']

registerHooks({
  resolve(specifier: string, context: unknown, nextResolve: NextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (!code || !RETRYABLE.has(code)) throw err
      for (const suffix of SUFFIXES) {
        try {
          return nextResolve(specifier + suffix, context)
        } catch {
          // Try the next shape; the original error is thrown if none land.
        }
      }
      throw err
    }
  },
} as never)
