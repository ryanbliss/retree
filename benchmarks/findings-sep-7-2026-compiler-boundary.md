# Compiler runtime boundary and overhead

The [full current-revision remeasurement](findings-sep-7-2026-compiler-remeasurement.md) adds repeated Neo workloads, compiler cost, sample builds, and browser hot reload checks.

PR #100 follow-up, measured September 7, 2026. Baseline is the PR's merge
base with main, `a889d81541279a43424c61fc7ddb539b4cdb8aae`.

## Architecture

Core imports a small handler-factory registry with type-only imports. The
optional compiler runtime registers `CompiledProxyHandler` factories. Core
creates handlers and views through their methods; it never imports
`compiled-node.ts` or `compiler-runtime.ts`. This removes the compiler's
circular runtime dependencies. It does not claim to remove older cycles
within core.

Only compiled handlers carry class metadata, keyless-getter state, and
view-bound method caches. Ordinary handlers have no compiler instance
fields. Compiled setters call `BaseProxyHandler.set`; internal deletes call
`BaseProxyHandler.deleteProperty`. Proxies and compiled accessors share
function-binding and property-tracking helpers.

`npm run lint:architecture` rejects imports of the optional compiler runtime
from core's ordinary modules. The benchmark also asserts the esbuild input
graph excludes `compiled-node.ts` when the compiler runtime is not imported.

## Bundle size and retained heap

Run `node scripts/benchmark-compiler-overhead.mjs`. An optional first
argument selects another pre-compiler baseline commit. The script extracts
that core into a temporary directory and removes all temporary files after
measurement.

Bundles export the full core API, use esbuild browser ESM output with
minification, and include no application code. The runtime-loaded variant
also exports `defineCompiledNode`; it does not include generated classes.
Heap measurements use separate Node processes with `--expose-gc`, a 2,000-row
warmup, then 100,000 rows with one nested object each. Every row and nested
object is materialized and the read checksum is checked. Five rounds
alternate process order. Reported heap is the retained workload allocation
after GC, excluding module loading and the warmup.

| Variant | Minified bytes | Gzip bytes | Median retained bytes |
| --- | ---: | ---: | ---: |
| Main baseline | 112,447 | 30,419 | 65,210,968 |
| Current, compiler off | 113,492 | 30,742 | 65,216,256 |
| Current, runtime loaded | 123,797 | 33,549 | 65,216,312 |

Compiler-off overhead versus main is 1,045 minified bytes, 323 gzip bytes,
and 5,288 retained bytes over the entire workload, about 0.008%. The retained
heap is effectively unchanged at this scale. Loading the optional runtime
adds bundle code but does not add state to ordinary handlers.

## Scalar reads

After the overhead run, ran these sequentially once each:

```sh
RETREE_COMPILER=0 npm run benchmark:node-reads
RETREE_COMPILER=1 npm run benchmark:node-reads
```

Nine measured samples per scenario after warmup, 1.8 million reads per
sample. These are microbenchmark medians, not application speedups.

| Scenario | Proxy | Compiled |
| --- | ---: | ---: |
| ReactiveNode base reads | 69.74 ms | 18.33 ms |
| ReactiveNode view reads | 67.81 ms | 17.16 ms |

The read benefit remains about 3.8–4.0x while mutations share the existing
runtime. This run does not measure memo-heavy workloads or write throughput.

## React coverage

`samples/04.convex-react-nextjs/app/page.spec.tsx` runs the real sample page
and models through the sample's `.babelrc`, with only the Convex transport
stubbed. It asserts compiled handlers and tests form state, asynchronous
submit, filtering, server updates, cached query results, and unsubscribe.
The cached-result test exposed emissions arriving before all dependency
edges were installed; installation now runs transactionally. The compiler
package has no React dependency.

Local validation: 1,680 tests, typecheck, doctor, architecture checks, package
builds, and the sample's Next.js 16 Turbopack production build pass. The Next
build uses a placeholder Convex URL and does not validate a live backend.
