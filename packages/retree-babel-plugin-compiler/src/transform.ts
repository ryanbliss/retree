/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import type { NodePath } from "@babel/core";
import { parse } from "@babel/parser";
import * as t from "@babel/types";

type Scope = NodePath["scope"];

export interface RetreeCompilerOptions {
    /**
     * Module specifiers that export `ReactiveNode` and the Retree decorators.
     * Defaults to `["@retreejs/core"]`.
     */
    coreModules?: string[];
    /**
     * Module the emitted code imports its runtime from. Defaults to
     * `"@retreejs/core/compiler-runtime"`.
     */
    runtimeModule?: string;
    /**
     * Names of base classes from other files whose subclasses should be
     * compiled even when they use no Retree decorator.
     */
    bases?: string[];
}

export const DEFAULT_CORE_MODULES: readonly string[] = ["@retreejs/core"];
export const DEFAULT_RUNTIME_MODULE = "@retreejs/core/compiler-runtime";

const RETREE_DECORATORS = [
    "memo",
    "select",
    "fnMemo",
    "ignore",
    "link",
] as const;
type RetreeDecorator = (typeof RETREE_DECORATORS)[number];

/** Runtime exports the emitted code references, keyed by local alias. */
const RUNTIME_IMPORTS = {
    R: "R",
    H: "H",
    V: "V",
    C: "C",
    define: "defineCompiledNode",
    rp: "readPrimitive",
    ro: "readObject",
    rf: "readFunction",
    ri: "readIgnored",
    rl: "readLinked",
    rg: "readGetterValue",
    rgf: "readGetterWithFrame",
    rgr: "recoverGetterRead",
    wf: "writeField",
    ft: "fieldTrampoline",
} as const;
type RuntimeAlias = keyof typeof RUNTIME_IMPORTS;
type RuntimeNames = Record<RuntimeAlias, string>;

enum FieldRole {
    Reactive = 0,
    Ignore = 1,
    Link = 2,
}

interface FieldPlan {
    key: string;
    role: FieldRole;
}

interface AccessorPlan {
    key: string;
    getter: boolean;
    setter: boolean;
}

interface ClassPlan {
    fields: FieldPlan[];
    accessors: AccessorPlan[];
    methods: string[];
}

export interface RetreeImportMap {
    reactiveNode: Set<string>;
    decorators: Map<RetreeDecorator, Set<string>>;
}

export function collectRetreeImports(
    program: NodePath<t.Program>,
    coreModules: readonly string[]
): RetreeImportMap {
    const imports: RetreeImportMap = {
        reactiveNode: new Set(),
        decorators: new Map(),
    };
    for (const statement of program.node.body) {
        if (!t.isImportDeclaration(statement)) continue;
        if (!coreModules.includes(statement.source.value)) continue;
        for (const specifier of statement.specifiers) {
            if (!t.isImportSpecifier(specifier)) continue;
            const imported = t.isIdentifier(specifier.imported)
                ? specifier.imported.name
                : specifier.imported.value;
            if (imported === "ReactiveNode") {
                imports.reactiveNode.add(specifier.local.name);
                continue;
            }
            if (isRetreeDecoratorName(imported)) {
                let locals = imports.decorators.get(imported);
                if (locals === undefined) {
                    locals = new Set();
                    imports.decorators.set(imported, locals);
                }
                locals.add(specifier.local.name);
            }
        }
    }
    return imports;
}

function isRetreeDecoratorName(name: string): name is RetreeDecorator {
    return (RETREE_DECORATORS as readonly string[]).includes(name);
}

/** Returns the Retree decorator a member decorator applies, if any. */
function resolveDecorator(
    decorator: t.Decorator,
    imports: RetreeImportMap
): { name: RetreeDecorator; argument: t.Expression | undefined } | undefined {
    const expression = decorator.expression;
    let callee: t.Expression;
    let argument: t.Expression | undefined;
    if (t.isCallExpression(expression)) {
        if (!t.isExpression(expression.callee)) return undefined;
        callee = expression.callee;
        const first = expression.arguments[0];
        argument =
            first !== undefined && t.isExpression(first) ? first : undefined;
    } else {
        callee = expression;
    }
    if (!t.isIdentifier(callee)) return undefined;
    for (const [name, locals] of imports.decorators) {
        if (locals.has(callee.name)) return { name, argument };
    }
    return undefined;
}

const qualificationCache = new WeakMap<t.Class, boolean>();

/**
 * A class compiles when it extends `ReactiveNode` (or a class that does,
 * declared in the same file or listed in `bases`), or when it applies any
 * Retree decorator.
 */
export function classQualifies(
    path: NodePath<t.ClassDeclaration>,
    imports: RetreeImportMap,
    bases: readonly string[]
): boolean {
    const cached = qualificationCache.get(path.node);
    if (cached !== undefined) return cached;
    const result = computeQualifies(path, imports, bases);
    qualificationCache.set(path.node, result);
    return result;
}

function computeQualifies(
    path: NodePath<t.ClassDeclaration>,
    imports: RetreeImportMap,
    bases: readonly string[]
): boolean {
    for (const member of path.node.body.body) {
        if (!("decorators" in member) || !member.decorators) continue;
        for (const decorator of member.decorators) {
            if (resolveDecorator(decorator, imports) !== undefined) return true;
        }
    }
    const superClass = path.node.superClass;
    if (!t.isIdentifier(superClass)) return false;
    if (imports.reactiveNode.has(superClass.name)) return true;
    if (bases.includes(superClass.name)) return true;
    const binding = path.scope.getBinding(superClass.name);
    if (binding === undefined) return false;
    if (!binding.path.isClassDeclaration()) return false;
    return classQualifies(binding.path, imports, bases);
}

function memberKeyName(
    key: t.Expression | t.PrivateName,
    computed: boolean
): string | undefined {
    if (computed) {
        return t.isStringLiteral(key) ? key.value : undefined;
    }
    if (t.isIdentifier(key)) return key.name;
    if (t.isStringLiteral(key)) return key.value;
    return undefined;
}

/**
 * Plans the managed class for one ReactiveNode subclass, or returns
 * `undefined` when a member shape the runtime cannot serve is present.
 */
export function planClass(
    node: t.ClassDeclaration,
    imports: RetreeImportMap
): ClassPlan | undefined {
    const fields = new Map<string, FieldRole>();
    const accessors = new Map<string, AccessorPlan>();
    const methods: string[] = [];
    const seen = new Set<string>();
    for (const member of node.body.body) {
        if (
            t.isClassPrivateProperty(member) ||
            t.isClassPrivateMethod(member)
        ) {
            return undefined;
        }
        if (t.isClassAccessorProperty(member)) return undefined;
        if (t.isTSIndexSignature(member)) return undefined;
        if (t.isStaticBlock(member)) continue;
        if (t.isTSDeclareMethod(member)) continue;
        if (t.isClassProperty(member)) {
            if (member.static || member.abstract || member.declare) continue;
            const key = memberKeyName(member.key, member.computed);
            if (key === undefined) return undefined;
            fields.set(key, resolveFieldRole(member.decorators, imports));
            seen.add(key);
            continue;
        }
        if (!t.isClassMethod(member)) continue;
        if (member.static || member.abstract) continue;
        if (member.kind === "constructor") {
            for (const param of member.params) {
                if (!t.isTSParameterProperty(param)) continue;
                const parameter = param.parameter;
                const identifier = t.isAssignmentPattern(parameter)
                    ? parameter.left
                    : parameter;
                if (!t.isIdentifier(identifier)) return undefined;
                if (!fields.has(identifier.name)) {
                    fields.set(identifier.name, FieldRole.Reactive);
                }
            }
            continue;
        }
        const key = memberKeyName(member.key, member.computed);
        if (key === undefined) return undefined;
        if (member.kind === "method") {
            if (!seen.has(key)) methods.push(key);
            seen.add(key);
            continue;
        }
        let accessor = accessors.get(key);
        if (accessor === undefined) {
            accessor = {
                key,
                getter: false,
                setter: false,
            };
            accessors.set(key, accessor);
        }
        if (member.kind === "get") {
            accessor.getter = true;
        } else {
            accessor.setter = true;
        }
    }
    return {
        fields: [...fields].map(([key, role]) => ({ key, role })),
        accessors: [...accessors.values()],
        methods,
    };
}

function resolveFieldRole(
    decorators: t.Decorator[] | null | undefined,
    imports: RetreeImportMap
): FieldRole {
    if (!decorators) return FieldRole.Reactive;
    for (const decorator of decorators) {
        const resolved = resolveDecorator(decorator, imports);
        if (resolved?.name === "ignore") return FieldRole.Ignore;
        if (resolved?.name === "link") return FieldRole.Link;
    }
    return FieldRole.Reactive;
}

function isIdentifierName(key: string): boolean {
    return t.isValidIdentifier(key, false);
}

/** `.key` or `["key"]` for use after an object expression. */
function memberAccess(key: string): string {
    return isIdentifierName(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

/** A class member name: bare identifier or quoted string. */
function memberName(key: string): string {
    return isIdentifierName(key) ? key : JSON.stringify(key);
}

function emitField(field: FieldPlan, n: RuntimeNames): string {
    const name = memberName(field.key);
    const access = memberAccess(field.key);
    const key = JSON.stringify(field.key);
    if (field.role === FieldRole.Ignore) {
        return `
get ${name}() { return ${n.ri}(this[${n.H}], ${key}, this[${n.R}]${access}); }
set ${name}(v) { ${n.wf}(this[${n.H}], ${key}, v); }`;
    }
    if (field.role === FieldRole.Link) {
        return `
get ${name}() { return ${n.rl}(this[${n.H}], ${key}, this[${n.R}]${access}); }
set ${name}(v) { ${n.wf}(this[${n.H}], ${key}, v); }`;
    }
    return `
get ${name}() {
    if (this === undefined) return ${n.ft}(${key});
    const v = this[${n.R}]${access};
    if (v === null || typeof v !== "object") {
        return typeof v === "function"
            ? ${n.rf}(this[${n.H}], this, ${key}, v, this[${n.V}])
            : ${n.rp}(this[${n.H}], ${key}, v);
    }
    return ${n.ro}(this[${n.H}], ${key}, v, this[${n.H}][${n.C}]${access}, this[${n.V}]);
}
set ${name}(v) { ${n.wf}(this[${n.H}], ${key}, v); }`;
}

/**
 * Reads on the prototype itself or with no receiver (test spies, reflection)
 * hand back the plain method so the accessor is transparent to them. Writes
 * shadow the method on the raw node, as the set trap does.
 */
function emitMethod(key: string, n: RuntimeNames): string {
    const name = memberName(key);
    const access = memberAccess(key);
    const quoted = JSON.stringify(key);
    return `
get ${name}() {
    if (this === undefined || this[${n.R}] === undefined) return super${access};
    return ${n.rf}(this[${n.H}], this, ${quoted}, this[${n.R}]${access}, this[${n.V}]);
}
set ${name}(v) { ${n.wf}(this[${n.H}], ${quoted}, v); }`;
}

function emitAccessor(accessor: AccessorPlan, n: RuntimeNames): string {
    const name = memberName(accessor.key);
    const access = memberAccess(accessor.key);
    const key = JSON.stringify(accessor.key);
    let code = "";
    if (accessor.getter) {
        code += `
get ${name}() {
    const h = this[${n.H}];
    if (h.keyless) return ${n.rgf}(h, this, ${key}, this[${n.V}]);
    let v;
    try { v = super${access}; }
    catch (e) { return ${n.rgr}(h, this, ${key}, e, this[${n.V}]); }
    return ${n.rg}(h, this, ${key}, v, this[${n.V}]);
}`;
    }
    if (accessor.setter) {
        code += `
set ${name}(v) { super${access} = v; }`;
    }
    return code;
}

function emitSchema(plan: ClassPlan): string {
    const fields = plan.fields
        .map((field) => `${JSON.stringify(field.key)}: ${field.role}`)
        .join(", ");
    return `{ fields: { ${fields} } }`;
}

/**
 * Builds the `defineCompiledNode(Class, schema, class { ... })` statement.
 */
export function buildDefineStatement(
    className: string,
    plan: ClassPlan,
    names: RuntimeNames
): t.Statement {
    const members: string[] = [
        `constructor(r, h) { this[${names.R}] = r; this[${names.H}] = h; }`,
    ];
    for (const field of plan.fields) members.push(emitField(field, names));
    for (const method of plan.methods) members.push(emitMethod(method, names));
    for (const accessor of plan.accessors) {
        members.push(emitAccessor(accessor, names));
    }
    const code = `${names.define}(${className}, ${emitSchema(
        plan
    )}, class {${members.join("\n")}\n});`;
    // Parsed directly: every name is already substituted, so the template
    // machinery (clone, placeholder walk, location scrub) has nothing to do.
    const statement = parse(code, { sourceType: "module" }).program.body[0];
    if (statement === undefined) {
        throw new Error(
            `Retree compiler: the managed class for ${className} produced no statement.`
        );
    }
    return statement;
}

export function createRuntimeNames(scope: Scope): RuntimeNames {
    const names: Partial<RuntimeNames> = {};
    for (const alias of Object.keys(RUNTIME_IMPORTS) as RuntimeAlias[]) {
        names[alias] = scope.generateUidIdentifier(alias).name;
    }
    return names as RuntimeNames;
}

export function buildRuntimeImport(
    names: RuntimeNames,
    runtimeModule: string
): t.ImportDeclaration {
    const specifiers = (Object.keys(RUNTIME_IMPORTS) as RuntimeAlias[]).map(
        (alias) =>
            t.importSpecifier(
                t.identifier(names[alias]),
                t.identifier(RUNTIME_IMPORTS[alias])
            )
    );
    return t.importDeclaration(specifiers, t.stringLiteral(runtimeModule));
}
