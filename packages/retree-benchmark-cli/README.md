# @retreejs/benchmark-cli

Deterministic Retree benchmarks for comparing `nodeChanged`, `treeChanged`,
and `ReactiveNode.dependencies` listener emission performance.

```bash
npm run build --workspace @retreejs/benchmark-cli
npm run benchmark
```

Useful flags:

```bash
retree-benchmark --profile stable --tiers all --workers 4
retree-benchmark --profile smoke --tiers low --workers 1
```

By default, results are written to `benchmarks/results/` as JSON and Markdown.
The CLI shards scenarios by depth, frequency, width, and callback read mode, then
uses an automatic worker cap based on local CPU parallelism. Use `--workers` to
raise or lower that cap when you want to trade runtime for CPU heat.

When run interactively without profile or tier flags, the CLI prompts for a
profile first (`Stable` is the default), then prompts for tier selection.
