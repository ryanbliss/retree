import { transformSync } from "@babel/core";
import { describe, expect, it } from "vitest";
import retreeCompiler, { type RetreeCompilerOptions } from "./index.js";

function compile(source: string, options: RetreeCompilerOptions = {}): string {
    const result = transformSync(source, {
        filename: "/virtual/file.ts",
        babelrc: false,
        configFile: false,
        presets: ["@babel/preset-typescript"],
        plugins: [
            [retreeCompiler, options],
            ["@babel/plugin-syntax-decorators", { version: "2023-11" }],
        ],
    });
    if (result === null || typeof result.code !== "string") {
        throw new Error("Babel produced no output.");
    }
    return result.code;
}

const RUNTIME_IMPORT = 'from "@retreejs/core/compiler-runtime"';

describe("retree compiler", () => {
    it("emits a managed class with field roles, methods, getters, and memos", () => {
        const code = compile(`
            import { ReactiveNode, ignore, link, memo } from "@retreejs/core";
            export class Foo extends ReactiveNode {
                a = 1;
                @ignore cache = null;
                @link other: Foo | null = null;
                constructor(public label: string) { super(); }
                method() { return this.a; }
                get plain() { return this.a * 2; }
                set plain(v: number) { this.a = v; }
                @memo((root: Foo) => [root.a, root.other?.label, "x"])
                get expensive(): number { return this.a + 1; }
                static count = 0;
            }
        `);
        expect(code).toContain(RUNTIME_IMPORT);
        expect(code).toContain(
            'fields: {\n    "a": 0,\n    "cache": 1,\n    "other": 2,\n    "label": 0\n  },\n  memos: ["expensive"]'
        );
        expect(code).toContain("_define(Foo, {");
        expect(code).toContain(
            '_rf(this[_H], this, "method", this[_R].method, this[_V])'
        );
        expect(code).toContain("v = super.plain;");
        expect(code).toContain("set plain(v) {\n    super.plain = v;\n  }");
        expect(code).toContain(
            "expensive$Foo$retreeMemo() {\n    return this.a + 1;\n  }"
        );
        expect(code).toContain("return this.expensive$Foo$retreeMemo();");
        expect(code).toContain(
            'k0 = this.a,\n      k1 = this.other?.label,\n      k2 = "x"'
        );
        expect(code).toContain(
            "_sk(c.k0, k0) && _sk(c.k1, k1) && _sk(c.k2, k2)"
        );
        expect(code).not.toContain("get count()");
    });

    it("keeps dynamic memo keys on the runtime decorator", () => {
        const code = compile(`
            import { ReactiveNode, memo } from "@retreejs/core";
            class Foo extends ReactiveNode {
                list: number[] = [];
                @memo((root: Foo) => root.list.map((x) => x))
                get total() { return 0; }
            }
        `);
        expect(code).toContain("memos: []");
        expect(code).toContain("v = super.total;");
        expect(code).not.toContain("total$retreeMemo");
    });

    it("compiles subclasses of same-file and listed bases", () => {
        const code = compile(
            `
            import { ReactiveNode } from "@retreejs/core";
            import { SharedBase } from "./shared.js";
            class Root extends ReactiveNode { a = 1; }
            class Child extends Root { b = 2; }
            class Listed extends SharedBase { c = 3; }
            class Untouched extends Other { d = 4; }
        `,
            { bases: ["SharedBase"] }
        );
        expect(code).toContain("_define(Root, {");
        expect(code).toContain("_define(Child, {");
        expect(code).toContain("_define(Listed, {");
        expect(code).not.toContain("_define(Untouched, {");
    });

    it("names anonymous default exports and places the definition after the export", () => {
        const code = compile(`
            import { ReactiveNode } from "@retreejs/core";
            export default class extends ReactiveNode { a = 1; }
        `);
        expect(code).toContain(
            "export default class _ReactiveNode extends ReactiveNode"
        );
        expect(code.indexOf("_define(_ReactiveNode")).toBeGreaterThan(
            code.indexOf("export default class")
        );
    });

    it("leaves classes with private or accessor members on the proxy path", () => {
        const code = compile(`
            import { ReactiveNode } from "@retreejs/core";
            class Private extends ReactiveNode { #secret = 1; }
            class Auto extends ReactiveNode { accessor a = 1; }
            class Computed extends ReactiveNode { [key] = 1; }
        `);
        expect(code).not.toContain("_define(");
        expect(code).not.toContain(RUNTIME_IMPORT);
    });

    it("ignores decorators that are not imported from a core module", () => {
        const code = compile(`
            import { ReactiveNode } from "@retreejs/core";
            import { ignore } from "./elsewhere.js";
            class Foo extends ReactiveNode { @ignore a = 1; }
        `);
        expect(code).toContain('"a": 0');
    });

    it("honours coreModules and runtimeModule options", () => {
        const code = compile(
            `
            import { ReactiveNode, ignore } from "../ReactiveNode.js";
            class Foo extends ReactiveNode { @ignore a = 1; }
        `,
            { coreModules: ["../ReactiveNode.js"], runtimeModule: "./rt.js" }
        );
        expect(code).toContain('from "./rt.js"');
        expect(code).toContain('"a": 1');
    });

    it("checks the memo version before reading any key", () => {
        const code = compile(`
            import { ReactiveNode, memo } from "@retreejs/core";
            class Foo extends ReactiveNode {
                a = 1;
                list: number[] = [];
                map: Record<string, { x: number }> | null = null;
                @memo((root: Foo) => [root.a, root.list?.[0], root.map?.["k"].x, 2n, null])
                get "odd-key"() { return this.a; }
            }
        `);
        const fastPath = code.indexOf("c.version === _cwv() && !_dta()");
        expect(fastPath).toBeGreaterThan(-1);
        expect(fastPath).toBeLessThan(code.indexOf("k0 = this.a"));
        expect(code).toContain(
            'k1 = this.list?.[0],\n      k2 = this.map?.["k"].x,\n      k3 = 2n,\n      k4 = null'
        );
        expect(code).toContain('"odd-key$Foo$retreeMemo"() {');
        expect(code).toContain('this["odd-key$Foo$retreeMemo"]()');
        expect(code).not.toContain("_S");
    });

    it("skips ambient class declarations", () => {
        const code = compile(`
            import { ReactiveNode } from "@retreejs/core";
            declare class Ambient extends ReactiveNode { a: number; }
            export class Foo extends ReactiveNode { a = 1; }
        `);
        expect(code).not.toContain("_define(Ambient");
        expect(code).toContain("_define(Foo, {");
    });

    it("does not touch files without Retree classes", () => {
        const source = "class Plain {\n  a = 1;\n}";
        expect(compile(source)).toBe(source);
    });
});
