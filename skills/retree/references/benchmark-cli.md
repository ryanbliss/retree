# @retreejs/benchmark-cli README

> Generated from the benchmark CLI package README.
> Source: `packages/retree-benchmark-cli/README.md`

# @retreejs/benchmark-cli

Deterministic Retree benchmarks for comparing `nodeChanged`, `treeChanged`,
`ReactiveNode.dependencies`, listener fan-out, and `Retree.select` listener
emission performance.

```bash
npm run build --workspace @retreejs/benchmark-cli
npm run benchmark
```

Useful flags:

```bash
retree-benchmark --profile stable --tiers all --workers 4
retree-benchmark --profile smoke --tiers low --workers 1
retree-benchmark --profile stable --tiers medium --name-suffix AFTER-PHASE-2 --overwrite
retree-benchmark --compare AFTER-PHASE-1 AFTER-PHASE-2
retree-benchmark compare AFTER-PHASE-1 AFTER-PHASE-2 --verbose
```

By default, results are written to `benchmarks/results/` as JSON and Markdown.
The CLI shards scenarios by depth, frequency, width, and callback read mode, then
uses an automatic worker cap based on local CPU parallelism. Use `--workers` to
raise or lower that cap when you want to trade runtime for CPU heat.

When run interactively without profile or tier flags, the CLI prompts for a
profile first (`Stable` is the default), then prompts for tier selection.

Use `--name-suffix` to write stable artifact names such as
`retree-benchmark-AFTER-PHASE-2.json`. Named artifacts are protected by
default; pass `--overwrite` when replacing a comparison point intentionally.

Use `--compare` or `compare` to compare saved JSON artifacts. Names may be plain
suffixes (`AFTER-PHASE-1`), full benchmark filenames, or absolute JSON paths.
By default, compare prints metadata, signal summary, and scenario summary. Add
`--verbose` to include the full matched-case table.
