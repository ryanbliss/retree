// Experiment: report what a ReactiveNode compiler could extract statically
// from @memo/@select/@fnMemo members. Loaded by run.mjs from a host repo's
// typescript-eslint so the type checker resolves that repo's program.
import { createRequire } from "node:module";

export function createReportRule(hostRoot) {
    const require = createRequire(hostRoot + "/package.json");
    const { AST_NODE_TYPES, ESLintUtils } = require("@typescript-eslint/utils");
    const ts = require("typescript");
    const ITERATION_METHODS = new Set([
        "map", "filter", "forEach", "find", "findIndex", "some", "every",
        "reduce", "flatMap", "values", "keys", "entries", "indexOf",
        "includes", "slice", "at", "sort", "toSorted", "join", "findLast",
        "reduceRight", "concat", "flat",
    ]);
    const RETREE_DECORATORS = new Set(["memo", "select", "fnMemo"]);
    const PRIMITIVE_FLAGS =
        ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike | ts.TypeFlags.EnumLike |
        ts.TypeFlags.Literal | ts.TypeFlags.BigIntLike |
        ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;

    function decoratorName(decorator) {
        const expr = decorator.expression;
        if (expr.type === AST_NODE_TYPES.Identifier) return expr.name;
        if (expr.type === AST_NODE_TYPES.CallExpression && expr.callee.type === AST_NODE_TYPES.Identifier) return expr.callee.name;
        return undefined;
    }
    function tsDecoratorNames(decl) {
        const names = [];
        const decorators = ts.canHaveDecorators(decl) ? ts.getDecorators(decl) ?? [] : [];
        for (const d of decorators) {
            const e = d.expression;
            if (ts.isIdentifier(e)) names.push(e.text);
            else if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) names.push(e.expression.text);
        }
        return names;
    }
    function extendsReactiveNode(checker, type, depth = 0) {
        if (!type || depth > 12) return false;
        if (type.isUnion()) return type.types.some((t) => extendsReactiveNode(checker, t, depth + 1));
        if (type.getSymbol()?.getName() === "ReactiveNode") return true;
        for (const base of checker.getBaseTypes(type) ?? []) {
            if (extendsReactiveNode(checker, base, depth + 1)) return true;
        }
        return false;
    }
    function classifyType(checker, type) {
        if (!type) return "unknown";
        if (type.isUnion()) {
            const parts = type.types.filter((t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
            if (parts.length === 1) return classifyType(checker, parts[0]);
            if (parts.every((t) => t.flags & PRIMITIVE_FLAGS)) return "primitive";
            return "union";
        }
        if (type.flags & PRIMITIVE_FLAGS) return "primitive";
        if (checker.isArrayType(type) || checker.isTupleType(type)) return "array";
        const name = type.getSymbol()?.getName();
        if (name === "Map" || name === "ReadonlyMap") return "map";
        if (name === "Set" || name === "ReadonlySet") return "set";
        if (type.getCallSignatures().length) return "function";
        if (type.flags & ts.TypeFlags.TypeParameter) return "generic";
        if (type.isClassOrInterface() || type.flags & ts.TypeFlags.Object) {
            return extendsReactiveNode(checker, type) ? "reactive-node" : "object";
        }
        return "unknown";
    }
    function countBy(items, fn) {
        const out = {};
        for (const item of items) {
            const key = fn(item);
            out[key] = (out[key] ?? 0) + 1;
        }
        return out;
    }
    function rootKind(d) {
        if (!d) return "?";
        if (d.decorators.includes("link")) return "link";
        if (d.decorators.includes("ignore")) return "ignore";
        if (d.member === "getter") {
            if (d.decorators.includes("memo")) return "memo-getter";
            if (d.decorators.includes("select")) return "select-getter";
            return "plain-getter";
        }
        if (d.member === "method") return "method";
        return "field:" + d.valueType;
    }

    return ESLintUtils.RuleCreator.withoutDocs({
        meta: { type: "suggestion", messages: { report: "{{json}}" }, schema: [] },
        defaultOptions: [],
        create(context) {
            const services = ESLintUtils.getParserServices(context);
            const checker = services.program.getTypeChecker();
            const sourceCode = context.sourceCode;

            function describeSegment(memberNode) {
                const tsNode = services.esTreeNodeToTSNodeMap.get(memberNode.property);
                const symbol = tsNode ? checker.getSymbolAtLocation(tsNode) : undefined;
                const decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
                let member = "unknown";
                let decorators = [];
                if (decl) {
                    if (ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl) || ts.isParameter(decl) || ts.isPropertyAssignment(decl) || ts.isShorthandPropertyAssignment(decl)) member = "field";
                    else if (ts.isGetAccessorDeclaration(decl)) member = "getter";
                    else if (ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl)) member = "method";
                    decorators = tsDecoratorNames(decl);
                }
                const valueType = classifyType(checker, services.getTypeAtLocation(memberNode));
                return { member, decorators, valueType };
            }

            function chainRoot(expr) {
                const segments = [];
                let node = expr;
                let computed = false;
                let callInChain = false;
                for (;;) {
                    if (node.type === AST_NODE_TYPES.ChainExpression || node.type === AST_NODE_TYPES.TSNonNullExpression || node.type === AST_NODE_TYPES.TSAsExpression) {
                        node = node.expression;
                        continue;
                    }
                    if (node.type === AST_NODE_TYPES.MemberExpression) {
                        if (node.computed) computed = true;
                        segments.unshift(node);
                        node = node.object;
                        continue;
                    }
                    if (node.type === AST_NODE_TYPES.CallExpression) {
                        callInChain = true;
                        node = node.callee;
                        continue;
                    }
                    break;
                }
                return { root: node, segments, computed, callInChain };
            }
            function findVariable(scope, name) {
                let current = scope;
                while (current) {
                    const variable = current.set.get(name);
                    if (variable) return variable;
                    current = current.upper;
                }
                return undefined;
            }
            function isChainLink(parent, node) {
                if (!parent) return false;
                if (parent.type === AST_NODE_TYPES.MemberExpression && parent.object === node) return true;
                if (parent.type === AST_NODE_TYPES.ChainExpression || parent.type === AST_NODE_TYPES.TSNonNullExpression || parent.type === AST_NODE_TYPES.TSAsExpression) return true;
                if (parent.type === AST_NODE_TYPES.CallExpression && parent.callee === node) return false;
                return false;
            }

            function analyzeFunction(fnNode, selfName, label) {
                const reads = [];
                const notes = { computed: 0, iteration: 0, methodCall: 0, getterCall: 0, external: 0, literalFallback: 0, retreeApi: 0, throughIgnore: 0, throughPlainObject: 0, param: 0, loops: 0 };
                const visited = new Set();
                const paramNames = new Set();
                for (const p of fnNode.params) {
                    if (p.type === AST_NODE_TYPES.Identifier) paramNames.add(p.name);
                    if (p.type === AST_NODE_TYPES.AssignmentPattern && p.left.type === AST_NODE_TYPES.Identifier) paramNames.add(p.left.name);
                }
                const isSelf = (node) => node.type === AST_NODE_TYPES.ThisExpression || (node.type === AST_NODE_TYPES.Identifier && node.name === selfName);
                // Module-level `let`/`var` is state a compiler cannot see; imports,
                // globals, constants, classes, enums, and functions are not reads.
                function isMutableModuleState(node, name) {
                    const variable = findVariable(sourceCode.getScope(node), name);
                    if (!variable || variable.scope.type !== "module") return false;
                    const def = variable.defs[0];
                    if (!def || def.type !== "Variable") return false;
                    return def.parent?.kind !== "const";
                }

                function visit(node, parent) {
                    if (!node || typeof node.type !== "string" || visited.has(node)) return;
                    visited.add(node);
                    const t = node.type;
                    if (t === AST_NODE_TYPES.ForOfStatement || t === AST_NODE_TYPES.ForInStatement || t === AST_NODE_TYPES.ForStatement || t === AST_NODE_TYPES.WhileStatement) notes.loops++;
                    if (t === AST_NODE_TYPES.LogicalExpression && (node.operator === "??" || node.operator === "||") && node.right.type === AST_NODE_TYPES.Literal) notes.literalFallback++;
                    if (t === AST_NODE_TYPES.MemberExpression && !isChainLink(parent, node)) {
                        const { root, segments, computed, callInChain } = chainRoot(node);
                        const isCallee = parent && parent.type === AST_NODE_TYPES.CallExpression && parent.callee === node;
                        if (root.type === AST_NODE_TYPES.Identifier && root.name === "Retree") {
                            notes.retreeApi++;
                        } else if (isSelf(root)) {
                            const described = segments.map(describeSegment);
                            const last = described[described.length - 1];
                            const before = described.slice(0, -1);
                            if (computed) notes.computed++;
                            if (before.some((d) => d.decorators.includes("ignore"))) notes.throughIgnore++;
                            if (before.some((d) => d.valueType === "object" || d.valueType === "union" || d.valueType === "generic" || d.valueType === "unknown")) notes.throughPlainObject++;
                            let kind = "static";
                            if (isCallee) {
                                const name = segments[segments.length - 1].computed ? "[]" : segments[segments.length - 1].property.name;
                                const receiver = described[described.length - 2];
                                if (name === "dependency" && segments.length === 1) { kind = "retree-api"; notes.retreeApi++; }
                                else if (receiver && (receiver.valueType === "array") && ITERATION_METHODS.has(name)) { kind = "iteration"; notes.iteration++; }
                                else if (receiver && (receiver.valueType === "map" || receiver.valueType === "set")) {
                                    if (name === "get" || name === "has") { kind = "computed"; notes.computed++; }
                                    else { kind = "iteration"; notes.iteration++; }
                                } else { kind = "method-call"; notes.methodCall++; }
                            } else if (callInChain) { kind = "method-call"; notes.methodCall++; }
                            else if (computed) kind = "computed";
                            if (last && last.member === "getter" && (last.decorators.includes("memo") || last.decorators.includes("select"))) notes.getterCall++;
                            reads.push({ kind, path: segments.map((s) => (s.computed ? "[]" : s.property.name)).join("."), root: described[0], leaf: last, depth: segments.length });
                        } else if (root.type === AST_NODE_TYPES.Identifier && paramNames.has(root.name)) {
                            notes.param++;
                        } else if (root.type === AST_NODE_TYPES.Identifier) {
                            if (isMutableModuleState(node, root.name)) notes.external++;
                        }
                    } else if (t === AST_NODE_TYPES.Identifier && parent && !(parent.type === AST_NODE_TYPES.MemberExpression && parent.property === node && !parent.computed) && !(parent.type === AST_NODE_TYPES.Property && parent.key === node && !parent.computed) && node.name !== selfName && !paramNames.has(node.name)) {
                        if (isMutableModuleState(node, node.name)) notes.external++;
                    }
                    if (t === AST_NODE_TYPES.ForOfStatement) {
                        const { root } = chainRoot(node.right);
                        if (isSelf(root)) { notes.iteration++; notes.loops--; }
                    }
                    for (const key of Object.keys(node)) {
                        if (key === "parent" || key === "loc" || key === "range" || key === "typeAnnotation" || key === "returnType" || key === "typeParameters" || key === "typeArguments" || key === "decorators") continue;
                        const child = node[key];
                        if (Array.isArray(child)) { for (const c of child) if (c && typeof c.type === "string") visit(c, node); }
                        else if (child && typeof child.type === "string") visit(child, node);
                    }
                }
                visit(fnNode.body, fnNode);
                const reasons = [];
                if (notes.computed) reasons.push("computed");
                if (notes.iteration) reasons.push("iteration");
                if (notes.methodCall) reasons.push("method-call");
                if (notes.external) reasons.push("external");
                if (notes.loops) reasons.push("loop");
                const staticReads = reads.filter((r) => r.kind === "static");
                let verdict = "static";
                if (reasons.length === 1 && reasons[0] === "iteration") verdict = "static+iteration";
                else if (reasons.length) verdict = "dynamic";
                if (reads.length === 0 && reasons.length === 0 && notes.param === 0 && notes.retreeApi === 0) verdict = "constant";
                return {
                    label, verdict, reasons,
                    reads: reads.length, staticReads: staticReads.length,
                    maxDepth: Math.max(0, ...reads.map((r) => r.depth)),
                    notes,
                    rootKinds: countBy(staticReads, (r) => rootKind(r.root)),
                    leafTypes: countBy(staticReads, (r) => r.leaf?.valueType ?? "?"),
                    staticPaths: staticReads.map((r) => r.path),
                    calls: reads.filter((r) => r.kind === "method-call").map((r) => r.path),
                };
            }

            return {
                ClassDeclaration(cls) {
                    if (!cls.superClass) return;
                    if (!extendsReactiveNode(checker, services.getTypeAtLocation(cls))) return;
                    const className = cls.id?.name ?? "<anon>";
                    const fields = { link: 0, ignore: 0, plain: 0, getters: 0, methods: 0 };
                    for (const member of cls.body.body) {
                        const decs = (member.decorators ?? []).map(decoratorName).filter(Boolean);
                        if (member.type === AST_NODE_TYPES.PropertyDefinition) {
                            if (decs.includes("link")) fields.link++;
                            else if (decs.includes("ignore")) fields.ignore++;
                            else fields.plain++;
                        }
                        if (member.type === AST_NODE_TYPES.MethodDefinition && member.kind === "get") fields.getters++;
                        if (member.type === AST_NODE_TYPES.MethodDefinition && member.kind === "method") fields.methods++;
                        const dec = (member.decorators ?? []).find((d) => RETREE_DECORATORS.has(decoratorName(d)));
                        if (member.type !== AST_NODE_TYPES.MethodDefinition) continue;
                        const memberName = member.key.type === AST_NODE_TYPES.Identifier ? member.key.name : "<computed>";
                        if (!dec) {
                            // Undecorated getters are what keys and bodies mostly read through.
                            if (member.kind !== "get" || memberName === "dependencies") continue;
                            const plain = { className, member: memberName, decorator: "none", key: null, body: analyzeFunction(member.value, " ", "body") };
                            context.report({ node: member.key, messageId: "report", data: { json: JSON.stringify(plain) } });
                            continue;
                        }
                        const report = { className, member: memberName, decorator: decoratorName(dec), key: null, body: null };
                        const callArg = dec.expression.type === AST_NODE_TYPES.CallExpression ? dec.expression.arguments[0] : undefined;
                        if (callArg && (callArg.type === AST_NODE_TYPES.ArrowFunctionExpression || callArg.type === AST_NODE_TYPES.FunctionExpression)) {
                            const selfName = callArg.params[0]?.type === AST_NODE_TYPES.Identifier ? callArg.params[0].name : "self";
                            report.key = analyzeFunction(callArg, selfName, "key");
                            report.key.elements = callArg.body.type === AST_NODE_TYPES.ArrayExpression ? callArg.body.elements.length : -1;
                        }
                        report.body = analyzeFunction(member.value, " ", "body");
                        context.report({ node: member.key, messageId: "report", data: { json: JSON.stringify(report) } });
                    }
                    context.report({ node: cls.id ?? cls, messageId: "report", data: { json: JSON.stringify({ className, classSummary: fields }) } });
                },
            };
        },
    });
}
