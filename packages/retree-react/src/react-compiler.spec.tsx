/**
 * React Compiler compatibility verification (audit spec §6.6).
 *
 * Two claims are pinned here:
 *
 * 1. **Consumer components compiled by the React Compiler work correctly
 *    with Retree hooks.** Components using `useNode` and `useSelect` are
 *    compiled with `babel-plugin-react-compiler` (the real plugin, real
 *    memo-cache runtime from `react/compiler-runtime`), then rendered:
 *    they re-render on relevant writes and skip unrelated writes. This is
 *    the compatibility story the docs claim — Retree hooks are
 *    `useSyncExternalStore`-based, so no observer HOC or Babel transform is
 *    needed and compiler memoization cannot detach a subscription.
 *
 * 2. **The `"use no memo"` directives on the hook source files are
 *    load-bearing.** They only matter when the library *source* is compiled
 *    (monorepo source consumers, this repo's vitest aliases, playground
 *    templates that inline src — never the published `bin/` output, since
 *    compilers skip node_modules by default). The last tests strip the
 *    directive from the real `useNodeInternalCore.ts` and pin the failure
 *    mode: the compiler memoizes `operations.getRenderReproxyNode(...)`
 *    keyed on `baseProxy` — which is intentionally *stable* across writes —
 *    so after a write the hook re-renders (useSyncExternalStore fires) but
 *    returns the cached pre-write reproxy. Field reads still pass through
 *    to the raw target, so plain text renders survive; what breaks is the
 *    hooks' *identity contract* ("a changed node is a new reference").
 *    Anything keyed on the node identity — a compiler-memoized derived
 *    value in a consumer component, `useMemo` deps, `React.memo` props —
 *    stays stale forever. The end-to-end test shows a compiled consumer
 *    component rendering stale UI with the directive stripped and correct
 *    UI with the shipped hook. If the identity assertions ever fail
 *    because the stripped build stops caching, the compiler has learned to
 *    handle impure reads like getReproxyNode — re-evaluate the directives.
 *
 * Note `useSelect.ts` has a second, independent protection: the compiler's
 * own validation rejects its functions (committed-state refs are read
 * during render by design, and the overload trampoline dispatches to hooks
 * conditionally), so it bails on that file even without the directive. The
 * directive still documents the intent.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { transformSync } from "@babel/core";
// The untyped Babel plugin/preset modules are passed straight through to
// @babel/core, which types plugin entries as `unknown`.
import reactCompiler from "babel-plugin-react-compiler";
import presetReact from "@babel/preset-react";
import commonjsTransform from "@babel/plugin-transform-modules-commonjs";
import ts from "typescript";
import * as React from "react";
import * as compilerRuntime from "react/compiler-runtime";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Retree, TreeNode } from "@retreejs/core";
import { getBaseProxy, getReproxyNode } from "@retreejs/core/internal";
import * as externalStoreModule from "./internals/externalStore.js";
import * as factoryWarningModule from "./internals/factoryWarning.js";
import { getRetreeExternalStoreSource } from "./internals/externalStore.js";
import { actOnRetree, createTestRoot } from "./testing/index.js";
import { useNode } from "./useNode.js";
import { useSelect } from "./useSelect.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
        cleanup();
    }
});

/**
 * Compile a JSX module source with the React Compiler, then lower it to
 * CommonJS so it can be evaluated in-process. Two Babel passes because the
 * compiler inserts its `react/compiler-runtime` import during its own
 * traversal; a second pass converts every import deterministically.
 */
function compileWithReactCompiler(source: string): string {
    const compiled = transformSync(source, {
        filename: "compiled-component.jsx",
        configFile: false,
        babelrc: false,
        sourceType: "module",
        presets: [[presetReact, { runtime: "classic" }]],
        plugins: [[reactCompiler, { target: "19" }]],
    });
    if (compiled === null || typeof compiled.code !== "string") {
        throw new Error(
            "react-compiler.spec: the React Compiler Babel pass returned no code for the test component source."
        );
    }
    const lowered = transformSync(compiled.code, {
        filename: "compiled-component.js",
        configFile: false,
        babelrc: false,
        sourceType: "module",
        plugins: [commonjsTransform],
    });
    if (lowered === null || typeof lowered.code !== "string") {
        throw new Error(
            "react-compiler.spec: the CommonJS lowering Babel pass returned no code for the compiled component."
        );
    }
    return lowered.code;
}

/**
 * Evaluate a CommonJS module string with an explicit module map. Anything
 * the compiled source imports must be listed here; unknown ids throw.
 */
function evaluateCommonJsModule(
    code: string,
    moduleMap: Record<string, unknown>
): Record<string, unknown> {
    const requireShim = (id: string): unknown => {
        if (id in moduleMap) {
            return moduleMap[id];
        }
        throw new Error(
            `react-compiler.spec: compiled test module required "${id}", which is not in the module map. Add it to the moduleMap passed to evaluateCommonJsModule.`
        );
    };
    const moduleShim: { exports: Record<string, unknown> } = { exports: {} };
    const evaluate = new Function("require", "module", "exports", code);
    evaluate(requireShim, moduleShim, moduleShim.exports);
    return moduleShim.exports;
}

interface RenderProbe {
    renders: string[];
    recordRender(name: string): void;
}

function createRenderProbe(): RenderProbe {
    const renders: string[] = [];
    return {
        renders,
        recordRender(name: string) {
            renders.push(name);
        },
    };
}

function countRenders(probe: RenderProbe, name: string): number {
    return probe.renders.filter((entry) => entry === name).length;
}

function isComponentType(
    value: unknown
): value is React.ComponentType<{ [key: string]: unknown }> {
    return typeof value === "function";
}

function getExportedComponent(
    exports: Record<string, unknown>,
    name: string
): React.ComponentType<{ [key: string]: unknown }> {
    const candidate = exports[name];
    if (!isComponentType(candidate)) {
        throw new Error(
            `react-compiler.spec: compiled test module did not export a component named "${name}".`
        );
    }
    return candidate;
}

const baseModuleMap: Record<string, unknown> = {
    react: React,
    "react/compiler-runtime": compilerRuntime,
};

describe("React Compiler compatibility (consumer components)", () => {
    it("useNode: compiler-memoized component re-renders on writes and skips unrelated writes", () => {
        const source = `
            import * as React from "react";
            import { useNode } from "@retreejs/react";
            import { probe } from "test-probe";

            export function Row({ task, name }) {
                probe.recordRender(name);
                const state = useNode(task);
                return (
                    <div data-testid={name}>{String(state.done)}</div>
                );
            }
        `;
        const compiled = compileWithReactCompiler(source);
        // Prove the compiler actually memoized the component — without this,
        // a silent bail-out would make the rest of the test vacuous.
        expect(compiled).toContain("react/compiler-runtime");

        const probe = createRenderProbe();
        const exports = evaluateCommonJsModule(compiled, {
            ...baseModuleMap,
            "@retreejs/react": { useNode },
            "test-probe": { probe },
        });
        const Row = getExportedComponent(exports, "Row");

        const { root, cleanup } = createTestRoot(() => ({
            tasks: [
                { title: "Ship it", done: false },
                { title: "Test it", done: false },
            ],
        }));
        cleanups.push(cleanup);

        render(
            <>
                <Row task={root.tasks[0]} name="row-0" />
                <Row task={root.tasks[1]} name="row-1" />
            </>
        );
        expect(countRenders(probe, "row-0")).toBe(1);

        actOnRetree(() => {
            root.tasks[0].done = true;
        });
        expect(screen.getByTestId("row-0").textContent).toBe("true");
        expect(countRenders(probe, "row-0")).toBe(2);
        // Unrelated write: the other row's subscription must not fire.
        expect(countRenders(probe, "row-1")).toBe(1);

        actOnRetree(() => {
            root.tasks[1].title = "Rename";
        });
        expect(countRenders(probe, "row-0")).toBe(2);
    });

    it("useSelect (node form): compiler-memoized component follows the selection and skips unrelated writes", () => {
        const source = `
            import * as React from "react";
            import { useSelect } from "@retreejs/react";
            import { probe } from "test-probe";

            export function DoneCount({ tasks }) {
                probe.recordRender("done-count");
                const doneCount = useSelect(
                    tasks,
                    (current) => current.filter((task) => task.done).length,
                    { listenerType: "treeChanged" }
                );
                return <div data-testid="done-count">{doneCount}</div>;
            }
        `;
        const compiled = compileWithReactCompiler(source);
        expect(compiled).toContain("react/compiler-runtime");

        const probe = createRenderProbe();
        const exports = evaluateCommonJsModule(compiled, {
            ...baseModuleMap,
            "@retreejs/react": { useSelect },
            "test-probe": { probe },
        });
        const DoneCount = getExportedComponent(exports, "DoneCount");

        const { root, cleanup } = createTestRoot(() => ({
            tasks: [
                { title: "Docs", done: false },
                { title: "Tests", done: true },
            ],
        }));
        cleanups.push(cleanup);

        render(<DoneCount tasks={root.tasks} />);
        expect(screen.getByTestId("done-count").textContent).toBe("1");
        expect(countRenders(probe, "done-count")).toBe(1);

        actOnRetree(() => {
            root.tasks[0].done = true;
        });
        expect(screen.getByTestId("done-count").textContent).toBe("2");
        expect(countRenders(probe, "done-count")).toBe(2);

        // Unrelated write: selection value is unchanged, so no re-render.
        actOnRetree(() => {
            root.tasks[0].title = "Better docs";
        });
        expect(countRenders(probe, "done-count")).toBe(2);
    });

    it("useSelect (tracked form): compiler-memoized component re-renders on tracked reads only", () => {
        const source = `
            import * as React from "react";
            import { useSelect } from "@retreejs/react";
            import { roots } from "test-roots";
            import { probe } from "test-probe";

            export function FirstTitle() {
                probe.recordRender("first-title");
                const title = useSelect(() => roots.project.tasks[0].title);
                return <div data-testid="first-title">{title}</div>;
            }
        `;
        const compiled = compileWithReactCompiler(source);
        expect(compiled).toContain("react/compiler-runtime");

        const { root, cleanup } = createTestRoot(() => ({
            tasks: [
                { title: "Docs", done: false },
                { title: "Tests", done: false },
            ],
        }));
        cleanups.push(cleanup);

        const probe = createRenderProbe();
        const exports = evaluateCommonJsModule(compiled, {
            ...baseModuleMap,
            "@retreejs/react": { useSelect },
            "test-roots": { roots: { project: root } },
            "test-probe": { probe },
        });
        const FirstTitle = getExportedComponent(exports, "FirstTitle");

        render(<FirstTitle />);
        expect(screen.getByTestId("first-title").textContent).toBe("Docs");

        actOnRetree(() => {
            root.tasks[0].title = "Better docs";
        });
        expect(screen.getByTestId("first-title").textContent).toBe(
            "Better docs"
        );
        expect(countRenders(probe, "first-title")).toBe(2);

        // Untracked field: no re-render.
        actOnRetree(() => {
            root.tasks[1].title = "Other";
        });
        expect(countRenders(probe, "first-title")).toBe(2);
    });
});

/**
 * Load the real `useNodeInternalCore.ts` source, optionally strip its
 * `"use no memo"` directive, type-strip it with esbuild, and run it through
 * the React Compiler pipeline.
 */
function compileUseNodeInternalCoreSource(stripDirective: boolean): string {
    const sourcePath = path.join(
        __dirname,
        "internals",
        "useNodeInternalCore.ts"
    );
    let source = readFileSync(sourcePath, "utf8");
    if (stripDirective) {
        const directive = '"use no memo";\n';
        if (!source.includes(directive)) {
            throw new Error(
                `react-compiler.spec: expected ${sourcePath} to contain a "use no memo" directive to strip. If the directive was removed on purpose, update this spec — it exists to prove the directive is load-bearing.`
            );
        }
        source = source.replace(directive, "");
    }
    const typeStripped = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;
    return compileWithReactCompiler(typeStripped);
}

/** The same operations object `useNodeInternal.ts` wires up in production. */
const realOperations = {
    getRenderBaseProxy<T extends TreeNode>(
        _listenerType: "nodeChanged" | "treeChanged",
        node: T
    ): T {
        return getBaseProxy(node);
    },
    getRenderReproxyNode<T extends TreeNode>(
        _listenerType: "nodeChanged" | "treeChanged",
        node: T
    ): T {
        return getReproxyNode(node);
    },
    getSource(
        listenerType: "nodeChanged" | "treeChanged",
        baseProxy: TreeNode
    ) {
        return getRetreeExternalStoreSource(baseProxy, listenerType);
    },
};

type UseTaskNode = (node: TreeNode) => TreeNode;

function evaluateUseNodeInternalCore(code: string): UseTaskNode {
    const exports = evaluateCommonJsModule(code, {
        ...baseModuleMap,
        "./externalStore.js": externalStoreModule,
        "./factoryWarning.js": factoryWarningModule,
    });
    const hook = exports.useNodeInternalCore;
    if (typeof hook !== "function") {
        throw new Error(
            "react-compiler.spec: compiled useNodeInternalCore module did not export useNodeInternalCore."
        );
    }
    const compiledCore = hook as (
        node: TreeNode,
        listenerType: "nodeChanged",
        hookName: "useNode",
        operations: typeof realOperations
    ) => TreeNode;
    return function useTaskNode(node: TreeNode): TreeNode {
        return compiledCore(node, "nodeChanged", "useNode", realOperations);
    };
}

/**
 * A consumer component compiled by the React Compiler whose derived value is
 * memoized on the node identity returned by the hook under test. The hook is
 * injected through the module map so the exact same compiled code runs once
 * against the shipped `useNode` and once against a directive-stripped
 * compiled build of the internals.
 */
const identityConsumerSource = `
    import * as React from "react";
    import { useTaskNode } from "hook-under-test";
    import { probe } from "test-probe";

    export function Row({ task }) {
        probe.recordRender("row");
        const state = useTaskNode(task);
        const label = probe.summarize(state);
        return <div data-testid="row">{label}</div>;
    }
`;

interface IdentityProbe extends RenderProbe {
    identities: TreeNode[];
    summarize(state: { done: boolean }): string;
}

function createIdentityProbe(): IdentityProbe {
    const base = createRenderProbe();
    const identities: TreeNode[] = [];
    return {
        ...base,
        identities,
        summarize(state) {
            identities.push(state);
            return `done:${state.done}`;
        },
    };
}

function renderIdentityConsumer(
    useTaskNode: UseTaskNode,
    task: TreeNode
): IdentityProbe {
    const compiled = compileWithReactCompiler(identityConsumerSource);
    expect(compiled).toContain("react/compiler-runtime");
    const probe = createIdentityProbe();
    const exports = evaluateCommonJsModule(compiled, {
        ...baseModuleMap,
        "hook-under-test": { useTaskNode },
        "test-probe": { probe },
    });
    const Row = getExportedComponent(exports, "Row");
    render(<Row task={task} />);
    return probe;
}

describe('"use no memo" directives on hook source files', () => {
    it("the directive is respected: compiling useNodeInternalCore.ts as-is emits no compiler memoization", () => {
        const compiled = compileUseNodeInternalCoreSource(false);
        expect(compiled).not.toContain("react/compiler-runtime");
    });

    it("control: the shipped useNode keeps the identity contract under a compiled consumer", () => {
        const { root, cleanup } = createTestRoot(() => ({
            tasks: [{ title: "Ship it", done: false }],
        }));
        cleanups.push(cleanup);

        const probe = renderIdentityConsumer(useNode, root.tasks[0]);
        expect(screen.getByTestId("row").textContent).toBe("done:false");

        actOnRetree(() => {
            root.tasks[0].done = true;
        });

        expect(countRenders(probe, "row")).toBe(2);
        // The shipped hook returned a fresh reproxy identity, so the
        // compiled consumer's memoized derived value recomputed.
        expect(probe.identities.length).toBe(2);
        expect(probe.identities[0]).not.toBe(probe.identities[1]);
        expect(screen.getByTestId("row").textContent).toBe("done:true");
    });

    it("the directive is load-bearing: stripping it caches the reproxy on the stable base proxy, breaking the identity contract and freezing derived UI", () => {
        // Sanity: the stripped build IS compiler-memoized.
        const compiled = compileUseNodeInternalCoreSource(true);
        expect(compiled).toContain("react/compiler-runtime");
        const useStaleTaskNode = evaluateUseNodeInternalCore(compiled);

        const { root, cleanup } = createTestRoot(() => ({
            tasks: [{ title: "Ship it", done: false }],
        }));
        cleanups.push(cleanup);

        const probe = renderIdentityConsumer(useStaleTaskNode, root.tasks[0]);
        expect(screen.getByTestId("row").textContent).toBe("done:false");

        actOnRetree(() => {
            root.tasks[0].done = true;
        });

        // The subscription still works — useSyncExternalStore fired and the
        // component function ran again...
        expect(countRenders(probe, "row")).toBe(2);
        // ...but the compiled internals memoized getRenderReproxyNode on the
        // *stable* base proxy identity and returned the cached pre-write
        // reproxy, so the consumer's derived value never recomputed: the UI
        // is stale even though the underlying node changed. This is the
        // exact failure "use no memo" prevents. If these assertions start
        // failing (fresh identity / "done:true"), the React Compiler has
        // learned to handle impure reads like getReproxyNode — re-evaluate
        // whether the directives can be removed (see the spec header).
        expect(probe.identities.length).toBe(1);
        expect(screen.getByTestId("row").textContent).toBe("done:false");
        expect(getReproxyNode(getBaseProxy(root.tasks[0])).done).toBe(true);
    });
});
