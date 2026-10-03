import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, test } from 'node:test'

// The two exemptions that cost real money if they are ever wrong.
//
// The Flutterwave webhook and the cron reconciliation endpoint must never be
// throttled: a dropped webhook is a paid order with no tickets behind it, and
// a throttled cron run is the thing that was supposed to catch that. The
// guarantee is structural — both are plain Next.js route handlers that never
// enter the tRPC middleware chain — and this file checks the structure rather
// than taking it on trust.
//
// It is a SOURCE check, not a behavioural one, and the reason is worth
// recording: `node --test` strips types rather than compiling them, and the
// fulfilment code these routes pull in uses TypeScript parameter properties,
// which strip-only mode refuses to load. Walking the import graph proves
// something stronger than one call would anyway — not "this request was not
// throttled" but "no module either route loads can reach the limiter at all".

const API_SRC = dirname(new URL(import.meta.url).pathname)
const REPO_ROOT = resolve(API_SRC, '../../..')

const LIMITER_FILES = [
  'packages/api/src/lib/rate-limit.ts',
  'packages/api/src/trpc.ts',
]

const EXEMPT_ROUTES = [
  'apps/web/app/api/flutterwave/webhook/route.ts',
  'apps/web/app/api/cron/reconcile-orders/route.ts',
]

// ─── A small resolver, enough for this repository's own modules ─────────────

/** Every `from '...'` / `import '...'` specifier in a source file. */
function specifiersIn(source: string): string[] {
  const found: string[] = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!)
  }
  return found
}

function existingFile(candidate: string): string | null {
  for (const path of [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    join(candidate, 'index.ts'),
    join(candidate, 'index.tsx'),
  ]) {
    try {
      if (statSync(path).isFile()) return path
    } catch {
      // Not this shape.
    }
  }
  return null
}

const workspaceExports = new Map<string, Record<string, string>>()

function exportsOf(pkg: string): Record<string, string> | null {
  if (workspaceExports.has(pkg)) return workspaceExports.get(pkg)!
  const manifestPath = join(REPO_ROOT, 'packages', pkg, 'package.json')
  let manifest: { exports?: Record<string, string> }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
  const map = manifest.exports ?? {}
  workspaceExports.set(pkg, map)
  return map
}

/**
 * Where a specifier lands, as a repository-relative path, or `null` for
 * anything outside this repository — an npm package cannot import our
 * limiter, so there is nothing to follow.
 */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  const absoluteFrom = join(REPO_ROOT, fromFile)

  if (specifier.startsWith('.')) {
    const hit = existingFile(resolve(dirname(absoluteFrom), specifier))
    return hit ? relative(REPO_ROOT, hit) : null
  }

  // `@/...` is the app's own root, per each app's tsconfig paths.
  if (specifier.startsWith('@/')) {
    const appRoot = fromFile.startsWith('apps/web/')
      ? 'apps/web'
      : fromFile.startsWith('apps/admin/')
        ? 'apps/admin'
        : null
    if (!appRoot) return null
    const hit = existingFile(join(REPO_ROOT, appRoot, specifier.slice(2)))
    return hit ? relative(REPO_ROOT, hit) : null
  }

  if (!specifier.startsWith('@ticketur/')) return null

  const [, pkg, ...rest] = specifier.split('/')
  if (!pkg) return null
  const map = exportsOf(pkg)
  if (!map) return null

  const subpath = rest.length > 0 ? `./${rest.join('/')}` : '.'
  const exact = map[subpath]
  if (exact) {
    const hit = existingFile(join(REPO_ROOT, 'packages', pkg, exact))
    return hit ? relative(REPO_ROOT, hit) : null
  }

  // One wildcard form, `"./lib/*": "./src/lib/*.ts"`, is all this repo uses.
  for (const [pattern, target] of Object.entries(map)) {
    if (!pattern.includes('*')) continue
    const [head, tail = ''] = pattern.split('*') as [string, string?]
    if (!subpath.startsWith(head) || !subpath.endsWith(tail)) continue
    const star = subpath.slice(head.length, subpath.length - tail.length)
    const hit = existingFile(
      join(REPO_ROOT, 'packages', pkg, target.replace('*', star))
    )
    return hit ? relative(REPO_ROOT, hit) : null
  }

  return null
}

/** Every file in this repository reachable from `entry`, including itself. */
function importGraphFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(join(REPO_ROOT, file), 'utf8')
    for (const specifier of specifiersIn(source)) {
      const next = resolveSpecifier(specifier, file)
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return seen
}

// ─── The checks ─────────────────────────────────────────────────────────────

describe('the import-graph walk itself', () => {
  // A structural proof is only worth having if the tool behind it works, so
  // the walk is first pointed at something it must find.
  test('reaches the limiter from a route that does use tRPC', () => {
    const graph = importGraphFrom('apps/web/app/api/trpc/[trpc]/route.ts')
    for (const file of LIMITER_FILES) {
      assert.ok(
        graph.has(file),
        `the walk should find ${file} from the tRPC route, or it proves nothing elsewhere`
      )
    }
  })

  test('follows workspace packages, not just relative imports', () => {
    const graph = importGraphFrom('apps/web/app/api/trpc/[trpc]/route.ts')
    assert.ok(graph.has('packages/api/src/routers/_app.ts'))
    assert.ok(graph.has('packages/api/src/routers/public/_index.ts'))
    assert.ok(graph.size > 50, `only walked ${graph.size} files`)
  })
})

describe('the endpoints that must never be throttled', () => {
  for (const route of EXEMPT_ROUTES) {
    test(`${route} cannot reach the rate limiter`, () => {
      const graph = importGraphFrom(route)
      assert.ok(graph.size > 5, `only walked ${graph.size} files from ${route}`)
      for (const file of LIMITER_FILES) {
        assert.equal(
          graph.has(file),
          false,
          `${route} loads ${file}; a payment notification could be dropped`
        )
      }
    })

    test(`${route} never calls a tRPC procedure`, () => {
      const source = readFileSync(join(REPO_ROOT, route), 'utf8')
      for (const forbidden of [
        'appRouter',
        'createTRPCContext',
        'createCaller',
        'fetchRequestHandler',
      ]) {
        assert.equal(
          source.includes(forbidden),
          false,
          `${route} mentions ${forbidden}`
        )
      }
    })
  }
})

describe('admin procedures', () => {
  function sourceFilesUnder(dir: string): string[] {
    const absolute = join(REPO_ROOT, dir)
    return readdirSync(absolute)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(dir, name))
  }

  const adminFiles = sourceFilesUnder('packages/api/src/routers/admin')

  test('there are some to check', () => {
    assert.ok(adminFiles.length >= 5, `found ${adminFiles.length} admin files`)
  })

  for (const file of adminFiles) {
    test(`${file} is built on adminProcedure, never publicProcedure`, () => {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8')
      assert.equal(
        source.includes('publicProcedure'),
        false,
        `${file} would inherit the rate limit`
      )
    })
  }
})

describe('the brake hangs off publicProcedure alone', () => {
  test('and no other builder in trpc.ts uses it', () => {
    const source = readFileSync(join(REPO_ROOT, 'packages/api/src/trpc.ts'), {
      encoding: 'utf8',
    })
    const uses = [...source.matchAll(/\.use\(throttlePublicCalls\)/g)]
    assert.equal(uses.length, 1, 'exactly one procedure should be throttled')
    assert.match(
      source,
      /export const publicProcedure = t\.procedure\.use\(throttlePublicCalls\)/
    )
    // Each of these is built from `t.procedure`, so none can pick the
    // middleware up by inheritance.
    for (const builder of [
      'protectedProcedure',
      'organizerProcedure',
      'vendorProcedure',
      'adminProcedure',
    ]) {
      assert.match(
        source,
        new RegExp(`export const ${builder} = t\\.procedure\\.use\\(`),
        `${builder} should be built from t.procedure`
      )
    }
  })
})
