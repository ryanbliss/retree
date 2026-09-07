/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import type { NodePath, PluginObj } from "@babel/core";
import * as t from "@babel/types";
import {
    buildDefineStatement,
    buildRuntimeImport,
    classQualifies,
    collectRetreeImports,
    createRuntimeNames,
    DEFAULT_CORE_MODULES,
    DEFAULT_RUNTIME_MODULE,
    hoistMemoBodies,
    planClass,
    type RetreeCompilerOptions,
    type RetreeImportMap,
} from "./transform.js";

export type { RetreeCompilerOptions } from "./transform.js";

interface FileState {
    imports: RetreeImportMap;
    names: ReturnType<typeof createRuntimeNames> | undefined;
}

/**
 * Babel plugin that emits a compiled managed class for every `ReactiveNode`
 * subclass so instances skip the Proxy path. Run it before the decorators
 * transform; the Retree decorators stay in place for raw instances.
 */
export default function retreeCompiler(
    _api: unknown,
    options: RetreeCompilerOptions = {}
): PluginObj {
    const coreModules = options.coreModules ?? DEFAULT_CORE_MODULES;
    const runtimeModule = options.runtimeModule ?? DEFAULT_RUNTIME_MODULE;
    const bases = options.bases ?? [];
    const states = new WeakMap<t.Program, FileState>();
    const compiled = new WeakSet<t.ClassDeclaration>();

    return {
        name: "retree-compiler",
        visitor: {
            Program: {
                enter(path) {
                    states.set(path.node, {
                        imports: collectRetreeImports(path, coreModules),
                        names: undefined,
                    });
                },
                exit(path) {
                    const state = states.get(path.node);
                    if (state?.names === undefined) return;
                    path.unshiftContainer(
                        "body",
                        buildRuntimeImport(state.names, runtimeModule)
                    );
                },
            },
            ClassDeclaration(path) {
                if (compiled.has(path.node)) return;
                const program = path.findParent((parent) => parent.isProgram());
                if (program === null || !program.isProgram()) return;
                const state = states.get(program.node);
                if (state === undefined) return;
                if (!classQualifies(path, state.imports, bases)) return;
                const plan = planClass(path.node, state.imports);
                if (plan === undefined) return;
                compiled.add(path.node);
                if (state.names === undefined) {
                    state.names = createRuntimeNames(program.scope);
                }
                const className = ensureClassName(path);
                hoistMemoBodies(path.node, className, plan);
                const statementPath = resolveStatement(path);
                statementPath.insertAfter(
                    buildDefineStatement(className, plan, state.names)
                );
            },
        },
    };
}

function ensureClassName(path: NodePath<t.ClassDeclaration>): string {
    const id = path.node.id;
    if (id !== null && id !== undefined) return id.name;
    const generated = path.scope.generateUidIdentifier("ReactiveNode");
    path.node.id = generated;
    return generated.name;
}

function resolveStatement(path: NodePath<t.ClassDeclaration>): NodePath {
    const parent = path.parentPath;
    if (
        parent !== null &&
        (parent.isExportNamedDeclaration() ||
            parent.isExportDefaultDeclaration())
    ) {
        return parent;
    }
    return path;
}
