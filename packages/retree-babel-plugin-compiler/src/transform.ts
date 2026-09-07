/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import type { NodePath } from "@babel/core";
import template from "@babel/template";
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
    S: "S",
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
    wi: "writeIgnored",
    wl: "writeLinked",
    cwv: "currentWriteVersion",
    nk: "normalizeKey",
    sk: "sameKey",
    mb: "runCompiledMemoBody",
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
    /** Static memo key expressions (roots rewritten to `this`); absent for plain getters. */
    memoKeys: t.Expression[] | undefined;
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
                memoKeys: undefined,
            };
            accessors.set(key, accessor);
        }
        if (member.kind === "get") {
            accessor.getter = true;
            accessor.memoKeys = resolveMemoKeys(member, imports);
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

function resolveMemoKeys(
    member: t.ClassMethod,
    imports: RetreeImportMap
): t.Expression[] | undefined {
    if (!member.decorators) return undefined;
    for (const decorator of member.decorators) {
        const resolved = resolveDecorator(decorator, imports);
        if (resolved?.name !== "memo") continue;
        if (resolved.argument === undefined) return undefined;
        return extractStaticKeys(resolved.argument);
    }
    return undefined;
}

function unwrapTypeSyntax(expression: t.Expression): t.Expression {
    let current = expression;
    for (;;) {
        if (
            t.isTSAsExpression(current) ||
            t.isTSSatisfiesExpression(current) ||
            t.isTSNonNullExpression(current) ||
            t.isTSTypeAssertion(current) ||
            t.isParenthesizedExpression(current)
        ) {
            current = current.expression;
            continue;
        }
        return current;
    }
}

/**
 * Reads the key selector of `@memo(fn)`. Static keys are an array literal
 * whose elements are literals or member chains on the selector's parameter;
 * anything else stays on the runtime memo path.
 */
export function extractStaticKeys(
    selector: t.Expression
): t.Expression[] | undefined {
    const fn = unwrapTypeSyntax(selector);
    if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) {
        return undefined;
    }
    if (fn.async || fn.generator) return undefined;
    if (fn.params.length > 1) return undefined;
    const param = fn.params[0];
    let paramName: string | undefined;
    if (param !== undefined) {
        if (!t.isIdentifier(param)) return undefined;
        paramName = param.name;
    }
    let array: t.Expression;
    if (t.isBlockStatement(fn.body)) {
        if (fn.body.body.length !== 1) return undefined;
        const statement = fn.body.body[0];
        if (!t.isReturnStatement(statement)) return undefined;
        if (statement.argument === null || statement.argument === undefined) {
            return undefined;
        }
        array = unwrapTypeSyntax(statement.argument);
    } else {
        array = unwrapTypeSyntax(fn.body);
    }
    if (!t.isArrayExpression(array)) return undefined;
    const keys: t.Expression[] = [];
    for (const element of array.elements) {
        if (element === null || t.isSpreadElement(element)) return undefined;
        const key = convertKeyElement(element, paramName);
        if (key === undefined) return undefined;
        keys.push(key);
    }
    return keys;
}

function convertKeyElement(
    element: t.Expression,
    paramName: string | undefined
): t.Expression | undefined {
    const expression = unwrapTypeSyntax(element);
    if (
        t.isStringLiteral(expression) ||
        t.isNumericLiteral(expression) ||
        t.isBooleanLiteral(expression) ||
        t.isNullLiteral(expression) ||
        t.isBigIntLiteral(expression)
    ) {
        return t.cloneNode(expression);
    }
    if (t.isIdentifier(expression) && expression.name === "undefined") {
        return t.identifier("undefined");
    }
    if (
        t.isMemberExpression(expression) ||
        t.isOptionalMemberExpression(expression)
    ) {
        const property = expression.property;
        if (expression.computed) {
            if (!t.isStringLiteral(property) && !t.isNumericLiteral(property)) {
                return undefined;
            }
        } else if (!t.isIdentifier(property)) {
            return undefined;
        }
        const object = unwrapTypeSyntax(expression.object);
        let convertedObject: t.Expression | undefined;
        if (t.isIdentifier(object) && object.name === paramName) {
            convertedObject = t.thisExpression();
        } else {
            convertedObject = convertKeyElement(object, paramName);
        }
        if (convertedObject === undefined) return undefined;
        if (t.isOptionalMemberExpression(expression)) {
            return t.optionalMemberExpression(
                convertedObject,
                t.cloneNode(property),
                expression.computed,
                expression.optional
            );
        }
        return t.memberExpression(
            convertedObject,
            t.cloneNode(property),
            expression.computed
        );
    }
    return undefined;
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

/** Per-class name so a subclass memo body never shadows its base's body. */
export function memoBodyMethodName(key: string, className: string): string {
    return `${key}$${className}$retreeMemo`;
}

function emitField(field: FieldPlan, n: RuntimeNames): string {
    const name = memberName(field.key);
    const access = memberAccess(field.key);
    const key = JSON.stringify(field.key);
    if (field.role === FieldRole.Ignore) {
        return `
get ${name}() { return ${n.ri}(this[${n.H}], ${key}, this[${n.R}]${access}); }
set ${name}(v) { ${n.wi}(this[${n.H}], ${key}); this[${n.R}]${access} = v; }`;
    }
    if (field.role === FieldRole.Link) {
        return `
get ${name}() { return ${n.rl}(this[${n.H}], ${key}, this[${n.R}]${access}); }
set ${name}(v) { ${n.wl}(this[${n.H}], ${key}, v); }`;
    }
    return `
get ${name}() {
    const v = this[${n.R}]${access};
    if (v === null || typeof v !== "object") {
        return typeof v === "function"
            ? ${n.rf}(this[${n.H}], this, ${key}, v, this[${n.V}])
            : ${n.rp}(this[${n.H}], ${key}, v);
    }
    return ${n.ro}(this[${n.H}], ${key}, v, this[${n.H}][${n.C}]${access}, this[${n.V}]);
}
set ${name}(v) { ${n.wf}(this[${n.H}], ${key}, this[${n.R}]${access}, v); }`;
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
set ${name}(v) { ${n.wf}(this[${n.H}], ${quoted}, this[${n.R}]${access}, v); }`;
}

function emitAccessor(
    accessor: AccessorPlan,
    className: string,
    n: RuntimeNames,
    placeholders: Map<string, t.Expression>
): string {
    const name = memberName(accessor.key);
    const access = memberAccess(accessor.key);
    const key = JSON.stringify(accessor.key);
    let code = "";
    if (accessor.getter && accessor.memoKeys !== undefined) {
        code += emitMemoGetter(
            accessor,
            className,
            accessor.memoKeys,
            n,
            placeholders
        );
    } else if (accessor.getter) {
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

function emitMemoGetter(
    accessor: AccessorPlan,
    className: string,
    keys: t.Expression[],
    n: RuntimeNames,
    placeholders: Map<string, t.Expression>
): string {
    const name = memberName(accessor.key);
    const access = memberAccess(accessor.key);
    const key = JSON.stringify(accessor.key);
    const bodyAccess = memberAccess(
        memoBodyMethodName(accessor.key, className)
    );
    const prefix = `k${placeholders.size}_`;
    const reads: string[] = [];
    const compares: string[] = [];
    const stores: string[] = [];
    keys.forEach((expression, index) => {
        const placeholder = `${prefix}${index}`;
        placeholders.set(placeholder, expression);
        reads.push(`k${index} = %%${placeholder}%%`);
        compares.push(`${n.sk}(c.k${index}, k${index})`);
        stores.push(`k${index}: ${n.nk}(k${index})`);
    });
    const declare = reads.length === 0 ? "" : `, ${reads.join(", ")}`;
    const hit = `return ${n.rg}(h, this, ${key}, c.value, this[${n.V}]);`;
    const revalidate =
        compares.length === 0
            ? hit
            : `if (c.version === ${n.cwv}()) ${hit}
        if (${compares.join(" && ")}) { c.version = ${n.cwv}(); ${hit} }`;
    const cell = ["value", `version: ${n.cwv}()`, ...stores].join(", ");
    return `
get ${name}() {
    const h = this[${n.H}], c = h.cells${access}${declare};
    if (c !== undefined) {
        ${revalidate}
    }
    const value = ${n.mb}(this, this[${n.R}]${bodyAccess});
    h.cells${access} = { ${cell} };
    return ${n.rg}(h, this, ${key}, value, this[${n.V}]);
}`;
}

function emitSchema(plan: ClassPlan): string {
    const fields = plan.fields
        .map((field) => `${JSON.stringify(field.key)}: ${field.role}`)
        .join(", ");
    const memos = plan.accessors
        .filter((accessor) => accessor.memoKeys !== undefined)
        .map((accessor) => JSON.stringify(accessor.key))
        .join(", ");
    return `{ fields: { ${fields} }, memos: [${memos}] }`;
}

/**
 * Builds the `defineCompiledNode(Class, schema, class { ... })` statement.
 */
export function buildDefineStatement(
    className: string,
    plan: ClassPlan,
    names: RuntimeNames
): t.Statement {
    const placeholders = new Map<string, t.Expression>();
    const members: string[] = [
        `constructor(r, h) { this[${names.R}] = r; this[${names.H}] = h; }`,
        `get [${names.S}]() { return this[${names.H}]; }`,
    ];
    for (const field of plan.fields) members.push(emitField(field, names));
    for (const method of plan.methods) members.push(emitMethod(method, names));
    for (const accessor of plan.accessors) {
        members.push(emitAccessor(accessor, className, names, placeholders));
    }
    const code = `${names.define}(${className}, ${emitSchema(
        plan
    )}, class {${members.join("\n")}\n});`;
    const build = template.statement(code, {
        syntacticPlaceholders: true,
        preserveComments: false,
    });
    const replacements: Record<string, t.Expression> = {};
    for (const [placeholder, expression] of placeholders) {
        replacements[placeholder] = expression;
    }
    return build(replacements);
}

/**
 * Moves the body of a compiled memo getter into a sibling method so the
 * managed accessor can run it under the memo body guard, and leaves the
 * decorated getter delegating to it for raw instances.
 */
export function hoistMemoBodies(
    node: t.ClassDeclaration,
    className: string,
    plan: ClassPlan
): void {
    const memoKeys = new Set(
        plan.accessors
            .filter((accessor) => accessor.memoKeys !== undefined)
            .map((accessor) => accessor.key)
    );
    if (memoKeys.size === 0) return;
    const added: t.ClassMethod[] = [];
    for (const member of node.body.body) {
        if (!t.isClassMethod(member) || member.kind !== "get") continue;
        if (member.static) continue;
        const key = memberKeyName(member.key, member.computed);
        if (key === undefined || !memoKeys.has(key)) continue;
        const bodyName = memoBodyMethodName(key, className);
        const method = t.classMethod(
            "method",
            t.identifier(bodyName),
            [],
            member.body
        );
        method.returnType = member.returnType;
        added.push(method);
        member.body = t.blockStatement([
            t.returnStatement(
                t.callExpression(
                    t.memberExpression(
                        t.thisExpression(),
                        t.identifier(bodyName)
                    ),
                    []
                )
            ),
        ]);
    }
    node.body.body.push(...added);
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
