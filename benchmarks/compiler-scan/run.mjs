// Usage: node benchmarks/compiler-scan/run.mjs <host-repo-root> [scan-dir]
// Lints every file under the host repo that declares a ReactiveNode subclass
// with rule.mjs and aggregates what a compiler could extract statically.
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createReportRule } from "./rule.mjs";

const hostRoot = resolve(process.argv[2]);
const scanRoot = resolve(hostRoot, process.argv[3] ?? "src");
const require = createRequire(hostRoot + "/package.json");
const { ESLint } = require("eslint");
const parser = require("@typescript-eslint/parser");

function walk(dir, out) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== "node_modules" && !entry.startsWith(".")) walk(full, out);
            continue;
        }
        if (!/\.tsx?$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) continue;
        if (/\bextends\s+\w+/.test(readFileSync(full, "utf8"))) out.push(full);
    }
    return out;
}
const files = walk(scanRoot, []);
console.error(`candidate files: ${files.length}`);

const eslint = new ESLint({
    cwd: hostRoot,
    overrideConfigFile: true,
    overrideConfig: [
        {
            files: ["**/*.ts", "**/*.tsx"],
            languageOptions: {
                parser,
                parserOptions: { projectService: true, tsconfigRootDir: hostRoot },
            },
            plugins: { scan: { rules: { report: createReportRule(hostRoot) } } },
            rules: { "scan/report": "warn" },
        },
    ],
});
const started = performance.now();
const results = await eslint.lintFiles(files);
console.error(`linted in ${((performance.now() - started) / 1000).toFixed(1)} s`);

const members = [];
const plainGetters = [];
const classes = [];
const errors = [];
for (const r of results) {
    for (const m of r.messages) {
        if (m.ruleId !== "scan/report") {
            if (m.fatal) errors.push(`${r.filePath}: ${m.message}`);
            continue;
        }
        const j = JSON.parse(m.message);
        const entry = { ...j, file: r.filePath.slice(hostRoot.length + 1) };
        if (j.classSummary) classes.push(entry);
        else if (j.decorator === "none") plainGetters.push(entry);
        else members.push(entry);
    }
}
if (errors.length) console.error(`fatal: ${errors.length} (files outside the tsconfig, skipped)`);
writeFileSync(join(hostRoot, ".retree-compiler-scan.json"), JSON.stringify({ classes, members, plainGetters }, null, 1));

const count = (items, fn) => {
    const o = {};
    for (const i of items) {
        const k = fn(i);
        o[k] = (o[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
};
const sum = (items, fn) => items.reduce((t, i) => t + fn(i), 0);
const expand = (items, pick) => items.flatMap((m) => Object.entries(pick(m)).flatMap(([k, n]) => Array(n).fill(k)));

console.log(`\n## Classes: ${classes.length}`);
console.log("fields", {
    link: sum(classes, (c) => c.classSummary.link),
    ignore: sum(classes, (c) => c.classSummary.ignore),
    plain: sum(classes, (c) => c.classSummary.plain),
    getters: sum(classes, (c) => c.classSummary.getters),
    methods: sum(classes, (c) => c.classSummary.methods),
});
console.log(`\n## Decorated members: ${members.length}`, count(members, (m) => m.decorator));
const keyed = members.filter((m) => m.key);
console.log(`\n## Key functions: ${keyed.length}`);
console.log("verdict", count(keyed, (m) => m.key.verdict));
console.log("reasons", count(keyed.flatMap((m) => (m.key.reasons.length ? m.key.reasons : ["(none)"])), (r) => r));
console.log("elements per key", count(keyed, (m) => m.key.elements));
console.log("static path root kinds", count(expand(keyed, (m) => m.key.rootKinds), (k) => k));
console.log("static path depth", count(keyed.flatMap((m) => m.key.staticPaths.map((p) => p.split(".").length)), (d) => d));
console.log("keys through @ignore", keyed.filter((m) => m.key.notes.throughIgnore).length, "| through plain object", keyed.filter((m) => m.key.notes.throughPlainObject).length, "| literal fallbacks", sum(keyed, (m) => m.key.notes.literalFallback), "| param reads", sum(keyed, (m) => m.key.notes.param), "| Retree.* calls", sum(keyed, (m) => m.key.notes.retreeApi), "| method calls", sum(keyed, (m) => m.key.notes.methodCall));
console.log("leaf value types", count(expand(keyed, (m) => m.key.leafTypes), (k) => k));

console.log(`\n## Getter/method bodies: ${members.length}`);
console.log("verdict", count(members, (m) => m.body.verdict));
console.log("reasons", count(members.flatMap((m) => (m.body.reasons.length ? m.body.reasons : ["(none)"])), (r) => r));
console.log("bodies through @ignore", members.filter((m) => m.body.notes.throughIgnore).length, "| loops", members.filter((m) => m.body.notes.loops).length, "| external reads", members.filter((m) => m.body.notes.external).length, "| getter-to-getter reads", sum(members, (m) => m.body.notes.getterCall), "| Retree.* calls", sum(members, (m) => m.body.notes.retreeApi));
console.log("static path root kinds", count(expand(members, (m) => m.body.rootKinds), (k) => k));
console.log("reads per body", count(members, (m) => (m.body.reads === 0 ? "0" : m.body.reads <= 2 ? "1-2" : m.body.reads <= 5 ? "3-5" : m.body.reads <= 10 ? "6-10" : ">10")));
const both = members.filter((m) => m.key && m.key.verdict === "static" && m.body.verdict === "static");
console.log(`\nmembers where key AND body are fully static: ${both.length} / ${keyed.length}`);
console.log("by decorator, key verdict:", Object.fromEntries(["memo", "select", "fnMemo"].map((d) => [d, count(keyed.filter((m) => m.decorator === d), (m) => m.key.verdict)])));
console.log("by decorator, body verdict:", Object.fromEntries(["memo", "select", "fnMemo"].map((d) => [d, count(members.filter((m) => m.decorator === d), (m) => m.body.verdict)])));
console.log("\nsample dynamic keys:", keyed.filter((m) => m.key.verdict === "dynamic").slice(0, 8).map((m) => `${m.className}.${m.member} [${m.key.reasons}]`));
console.log("sample static keys:", keyed.filter((m) => m.key.verdict === "static").slice(0, 4).map((m) => `${m.className}.${m.member}: ${m.key.staticPaths.join(", ")}`));
console.log("sample dynamic bodies:", members.filter((m) => m.body.verdict === "dynamic").slice(0, 8).map((m) => `${m.className}.${m.member} [${m.body.reasons}]`));

console.log(`\n## Undecorated getters (what keys and bodies read through): ${plainGetters.length}`);
console.log("verdict", count(plainGetters, (m) => m.body.verdict));
console.log("reasons", count(plainGetters.flatMap((m) => (m.body.reasons.length ? m.body.reasons : ["(none)"])), (r) => r));
console.log("static path root kinds", count(expand(plainGetters, (m) => m.body.rootKinds), (k) => k));
console.log("through @ignore", plainGetters.filter((m) => m.body.notes.throughIgnore).length);

const calleeTally = (items, pick) => Object.entries(count(items.flatMap((m) => pick(m)?.calls ?? []), (p) => p.split(".").slice(-1)[0] + "()")).slice(0, 15);
console.log("\n## Top callees behind 'method-call' (keys):", calleeTally(members, (m) => m.key));
console.log("## Top callees behind 'method-call' (decorated bodies):", calleeTally(members, (m) => m.body));
console.log("## Top callees behind 'method-call' (undecorated getters):", calleeTally(plainGetters, (m) => m.body));
