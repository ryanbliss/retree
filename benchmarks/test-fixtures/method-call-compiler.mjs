// Benchmark-only Babel plugin, run before the Retree compiler.
import {
    collectRetreeImports,
    classQualifies,
    planClass,
} from "../../packages/retree-babel-plugin-compiler/bin/transform.js";
import { FUNCTION_NAMES_BIND_TO_RAW } from "../../packages/retree-core/bin/internals/proxy.js";
export default function methodCalls({ types: t }) {
    return {
        name: "retree-method-call-experiment",
        visitor: {
            Program: {
                enter(path, state) {
                    state.calls = 0;
                    state.imports = collectRetreeImports(
                        path,
                        state.opts.coreModules ?? ["@retreejs/core"]
                    );
                },
                exit(path, state) {
                    if (!state.calls) return;
                    path.unshiftContainer(
                        "body",
                        t.importDeclaration(
                            [
                                t.importSpecifier(
                                    state.prepare,
                                    t.identifier("prepareMethodCall")
                                ),
                                t.importSpecifier(
                                    state.invoke,
                                    t.identifier("invokeMethodCall")
                                ),
                                ...Object.entries(state.directNames ?? {}).map(
                                    ([imported, local]) =>
                                        t.importSpecifier(
                                            local,
                                            t.identifier(imported)
                                        )
                                ),
                            ],
                            t.stringLiteral(state.opts.runtimeModule)
                        )
                    );
                },
            },
            ClassDeclaration(path, state) {
                if (
                    !classQualifies(path, state.imports, state.opts.bases ?? [])
                )
                    return;
                if (!planClass(path.node, state.imports)) return;
                const methods = new Set(
                    path.node.body.body
                        .filter(
                            (m) =>
                                t.isClassMethod(m) &&
                                !m.static &&
                                m.kind === "method" &&
                                !m.computed &&
                                t.isIdentifier(m.key) &&
                                !FUNCTION_NAMES_BIND_TO_RAW.has(m.key.name) &&
                                !m.decorators?.length
                        )
                        .map((m) => m.key.name)
                );
                if (!methods.size) return;
                const program = path.findParent((p) => p.isProgram());
                for (const member of path.get("body.body")) {
                    if (
                        !member.isClassMethod() ||
                        member.node.static ||
                        member.node.kind === "constructor"
                    )
                        continue;
                    member.get("body").traverse({
                        Class(p) {
                            p.skip();
                        },
                        Function(p) {
                            if (!p.isArrowFunctionExpression()) p.skip();
                        },
                        CallExpression(call) {
                            const callee = call.node.callee;
                            if (
                                !t.isMemberExpression(callee) ||
                                callee.computed ||
                                !t.isThisExpression(callee.object) ||
                                !t.isIdentifier(callee.property) ||
                                !methods.has(callee.property.name) ||
                                call.node.arguments.some((a) =>
                                    t.isArgumentPlaceholder(a)
                                )
                            )
                                return;
                            state.prepare ??=
                                program.scope.generateUidIdentifier(
                                    "prepareMethodCall"
                                );
                            state.invoke ??=
                                program.scope.generateUidIdentifier(
                                    "invokeMethodCall"
                                );
                            const prepared = t.callExpression(state.prepare, [
                                t.thisExpression(),
                                t.stringLiteral(callee.property.name),
                            ]);
                            if (state.opts.strategy === "prepared") {
                                call.replaceWith(
                                    t.callExpression(state.invoke, [
                                        prepared,
                                        t.arrayExpression(call.node.arguments),
                                    ])
                                );
                            } else {
                                state.directNames ??= Object.fromEntries(
                                    [
                                        "H",
                                        "R",
                                        "V",
                                        "resolveFunctionReceiver",
                                        "applyMethod",
                                    ].map((key) => [
                                        key,
                                        program.scope.generateUidIdentifier(
                                            key
                                        ),
                                    ])
                                );
                                const n = state.directNames;
                                const own = (key) =>
                                    t.memberExpression(
                                        t.thisExpression(),
                                        n[key],
                                        true
                                    );
                                const fn = t.memberExpression(
                                    own("R"),
                                    t.cloneNode(callee.property)
                                );
                                const receiver = t.callExpression(
                                    n.resolveFunctionReceiver,
                                    [own("H"), own("V")]
                                );
                                const fast = t.callExpression(n.applyMethod, [
                                    fn,
                                    receiver,
                                    t.arrayExpression(call.node.arguments),
                                ]);
                                call.replaceWith(
                                    t.conditionalExpression(
                                        own("H"),
                                        fast,
                                        t.cloneNode(call.node, true)
                                    )
                                );
                            }
                            state.calls++;
                            call.skip();
                        },
                    });
                }
            },
        },
    };
}
