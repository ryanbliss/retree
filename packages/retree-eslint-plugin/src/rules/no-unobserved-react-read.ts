import path from "node:path";
import {
    AST_NODE_TYPES,
    ESLintUtils,
    type TSESLint,
    type TSESTree,
} from "@typescript-eslint/utils";
import ts from "typescript";

type CoverageKind = "own" | "tree";
type ConfiguredCoverageKind = "own" | "tree" | "raw-own" | "raw-tree";
type ConfiguredResult = "value" | "tuple-first";

interface HookBehavior {
    observes: ConfiguredCoverageKind;
    result?: ConfiguredResult;
}

type AdditionalHook = HookBehavior &
    ({ file: string; export: string } | { package: string; export: string });

export interface NoUnobservedReactReadOptions {
    additionalHooks?: AdditionalHook[];
    baseDirectory?: string;
    checkJsxKeys?: boolean;
}

type Options = [NoUnobservedReactReadOptions?];

type MessageIds =
    | "invalidAdditionalHook"
    | "unobservedDirectRawChildRead"
    | "unobservedNodeRead"
    | "unobservedRawRead";

interface ImportedIdentity {
    exportName: string;
    moduleName: string;
    resolvedFileName?: string;
}

interface NamespaceIdentity {
    moduleName: string;
    resolvedFileName?: string;
}

interface NormalizedAdditionalHook extends HookBehavior {
    exportName: string;
    target: string;
    targetKind: "file" | "package";
}

interface Provenance {
    kind: "provenance";
    origin: object;
    path: readonly string[];
    raw: boolean;
    rawBasePath?: readonly string[];
}

interface Converter {
    origin: object;
    rawBasePath: readonly string[];
}

interface TupleValue {
    kind: "tuple";
    converter?: Converter;
    first: Provenance;
}

type ValueInfo = Provenance | TupleValue;

interface Coverage {
    hookName: string;
    kind: CoverageKind;
    observedPath: string;
    origin: object;
    path: readonly string[];
}

interface HookDescriptor {
    configuredCoverage?: CoverageKind;
    hookName: string;
    kind: "node" | "raw" | "root" | "tree";
    providesConverter?: boolean;
    result: ConfiguredResult;
}

interface MemberSegment {
    key: string;
    node: TSESTree.MemberExpression;
}

type FunctionNode =
    | TSESTree.ArrowFunctionExpression
    | TSESTree.FunctionDeclaration
    | TSESTree.FunctionExpression;

const createRule = ESLintUtils.RuleCreator(
    (name) => `https://www.retree.dev/eslint/${name}`
);

const RETREE_CORE_MODULE = "@retreejs/core";
const RETREE_REACT_MODULE = "@retreejs/react";

const synchronousArrayMethods = new Set([
    "every",
    "filter",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
]);

const transparentExpressionTypes = new Set<string>([
    AST_NODE_TYPES.ChainExpression,
    AST_NODE_TYPES.TSAsExpression,
    AST_NODE_TYPES.TSNonNullExpression,
    AST_NODE_TYPES.TSTypeAssertion,
]);

export const noUnobservedReactRead = createRule<Options, MessageIds>({
    name: "no-unobserved-react-read",
    meta: {
        type: "problem",
        docs: {
            description:
                "Detect render-time Retree reads that are not covered by a React observation",
        },
        schema: [
            {
                type: "object",
                additionalProperties: false,
                properties: {
                    additionalHooks: {
                        type: "array",
                        items: {
                            oneOf: [
                                {
                                    type: "object",
                                    additionalProperties: false,
                                    required: ["file", "export", "observes"],
                                    properties: {
                                        file: { type: "string" },
                                        export: { type: "string" },
                                        observes: {
                                            type: "string",
                                            enum: [
                                                "own",
                                                "tree",
                                                "raw-own",
                                                "raw-tree",
                                            ],
                                        },
                                        result: {
                                            type: "string",
                                            enum: ["value", "tuple-first"],
                                        },
                                    },
                                },
                                {
                                    type: "object",
                                    additionalProperties: false,
                                    required: ["package", "export", "observes"],
                                    properties: {
                                        package: { type: "string" },
                                        export: { type: "string" },
                                        observes: {
                                            type: "string",
                                            enum: [
                                                "own",
                                                "tree",
                                                "raw-own",
                                                "raw-tree",
                                            ],
                                        },
                                        result: {
                                            type: "string",
                                            enum: ["value", "tuple-first"],
                                        },
                                    },
                                },
                            ],
                        },
                    },
                    baseDirectory: { type: "string" },
                    checkJsxKeys: { type: "boolean" },
                },
            },
        ],
        messages: {
            invalidAdditionalHook:
                "Configured Retree hook {{target}}#{{exportName}} was encountered, but its export identity could not be resolved. Check baseDirectory, the file/package target, and the barrel export.",
            unobservedDirectRawChildRead:
                '{{readPath}} reads data owned by the direct raw child {{rawOwnerPath}}, which useRaw({{observedPath}}) does not invalidate. Convert that direct child with this hook\'s toManaged and observe it, select from the managed tree, or deliberately use { listenerType: "treeChanged" }.',
            unobservedNodeRead:
                "{{readPath}} reads fields owned by {{ownerPath}} during render. Current Retree React coverage ({{observingHook}} on {{observedPath}}) does not include that owner. Observe {{ownerPath}}, select the value, use useTree deliberately, or forward the change through ReactiveNode.dependencies / @select.",
            unobservedRawRead:
                '{{readPath}} reads deeper raw data that useRaw({{observedPath}}) does not invalidate. toManaged does not guarantee resolution at {{rawOwnerPath}}. Restructure so the owner is a direct child of the subscribed node, select from the managed tree, or deliberately use { listenerType: "treeChanged" }.',
        },
    },
    defaultOptions: [{}],
    create(context, [providedOptions]) {
        const options = providedOptions ?? {};
        const normalizedAdditionalHooks = normalizeAdditionalHooks(options);

        let services: ReturnType<typeof ESLintUtils.getParserServices>;
        try {
            services = ESLintUtils.getParserServices(context);
        } catch {
            throw new Error(
                "@retreejs/no-unobserved-react-read requires TypeScript parser services. Fix: configure @typescript-eslint/parser with parserOptions.projectService (or parserOptions.project) for every file using this rule."
            );
        }

        const checker = services.program.getTypeChecker();
        const sourceCode = context.sourceCode;
        const arrayLikeCache = new WeakMap<TSESTree.Node, boolean>();
        const importedIdentities = new Map<ts.Symbol, ImportedIdentity>();
        const importedNamespaces = new Map<ts.Symbol, NamespaceIdentity>();
        const functionNodes: FunctionNode[] = [];
        const invalidAdditionalHookReports = new Set<string>();
        const objectLikeCache = new WeakMap<TSESTree.Node, boolean>();
        const symbolCache = new WeakMap<TSESTree.Node, ts.Symbol | null>();
        const reactiveNodeTypeCache = new WeakMap<ts.Type, boolean>();
        const inspectedReactiveNodeCandidates = new WeakMap<
            ts.SourceFile,
            Set<ts.Symbol>
        >();
        const unmodeledSemanticsCache = new WeakMap<
            TSESTree.MemberExpression,
            boolean
        >();
        let reactiveNodeSymbol: ts.Symbol | undefined;

        function getSymbol(node: TSESTree.Node): ts.Symbol | undefined {
            const cached = symbolCache.get(node);
            if (cached !== undefined) {
                return cached ?? undefined;
            }
            const tsNode = services.esTreeNodeToTSNodeMap.get(node);
            const symbol = checker.getSymbolAtLocation(tsNode);
            symbolCache.set(node, symbol ?? null);
            return symbol;
        }

        function collectImports(program: TSESTree.Program): void {
            for (const statement of program.body) {
                if (statement.type !== AST_NODE_TYPES.ImportDeclaration) {
                    continue;
                }

                const moduleName = String(statement.source.value);
                const moduleSymbol = getSymbol(statement.source);
                const resolvedFileName = getResolvedModuleFileName(
                    statement.source
                );
                if (moduleName === RETREE_CORE_MODULE) {
                    resolveReactiveNodeTypeFromModuleSymbol(moduleSymbol);
                } else {
                    resolveReactiveNodeTypeFromImportedModule(moduleSymbol);
                }
                validateEncounteredAdditionalHookTarget(
                    program,
                    statement,
                    moduleName,
                    resolvedFileName
                );

                for (const specifier of statement.specifiers) {
                    const localSymbol = getSymbol(specifier.local);
                    if (localSymbol === undefined) {
                        continue;
                    }
                    if (
                        specifier.type ===
                        AST_NODE_TYPES.ImportNamespaceSpecifier
                    ) {
                        importedNamespaces.set(localSymbol, {
                            moduleName,
                            resolvedFileName,
                        });
                        continue;
                    }

                    let exportName = "default";
                    if (specifier.type === AST_NODE_TYPES.ImportSpecifier) {
                        exportName = getImportName(specifier.imported);
                    }
                    importedIdentities.set(localSymbol, {
                        exportName,
                        moduleName,
                        resolvedFileName,
                    });
                }
            }
        }

        function getResolvedModuleFileName(
            source: TSESTree.StringLiteral
        ): string | undefined {
            const sourceSymbol = getSymbol(source);
            const declaration = sourceSymbol?.declarations?.[0];
            if (declaration === undefined) {
                return undefined;
            }
            return normalizeFileName(declaration.getSourceFile().fileName);
        }

        function validateEncounteredAdditionalHookTarget(
            program: TSESTree.Program,
            statement: TSESTree.ImportDeclaration,
            moduleName: string,
            resolvedFileName: string | undefined
        ): void {
            const matchingHooks = normalizedAdditionalHooks.filter((hook) => {
                if (hook.targetKind === "package") {
                    return hook.target === moduleName;
                }
                return (
                    resolvedFileName !== undefined &&
                    hook.target === resolvedFileName
                );
            });
            if (matchingHooks.length === 0) {
                return;
            }

            const sourceSymbol = getSymbol(statement.source);
            if (sourceSymbol === undefined) {
                reportInvalidAdditionalHooks(program, matchingHooks);
                return;
            }

            const exportsByName = new Map(
                checker
                    .getExportsOfModule(sourceSymbol)
                    .map((exportedSymbol) => [
                        exportedSymbol.getName(),
                        exportedSymbol,
                    ])
            );
            const invalidHooks = matchingHooks.filter((hook) => {
                const exportedSymbol = exportsByName.get(hook.exportName);
                if (exportedSymbol === undefined) {
                    return true;
                }
                return !canResolveAlias(exportedSymbol);
            });
            reportInvalidAdditionalHooks(program, invalidHooks);
        }

        function reportInvalidAdditionalHooks(
            program: TSESTree.Program,
            hooks: readonly NormalizedAdditionalHook[]
        ): void {
            for (const hook of hooks) {
                const reportKey = `${hook.targetKind}:${hook.target}:${hook.exportName}`;
                if (invalidAdditionalHookReports.has(reportKey)) {
                    continue;
                }
                invalidAdditionalHookReports.add(reportKey);
                context.report({
                    node: program,
                    messageId: "invalidAdditionalHook",
                    data: {
                        exportName: hook.exportName,
                        target: hook.target,
                    },
                });
            }
        }

        function resolveAlias(symbol: ts.Symbol): ts.Symbol | undefined {
            const visited = new Set<ts.Symbol>();
            let current = symbol;
            let edgesFollowed = 0;
            while ((current.flags & ts.SymbolFlags.Alias) !== 0) {
                if (visited.has(current)) {
                    return undefined;
                }
                visited.add(current);
                if (edgesFollowed >= 4) {
                    return undefined;
                }
                const next = checker.getAliasedSymbol(current);
                if (next === current || next.flags === ts.SymbolFlags.None) {
                    return undefined;
                }
                current = next;
                edgesFollowed += 1;
            }
            if (current.declarations === undefined) {
                return undefined;
            }
            return current;
        }

        function canResolveAlias(symbol: ts.Symbol): boolean {
            return resolveAlias(symbol) !== undefined;
        }

        function analyzeFunction(root: FunctionNode): void {
            if (!isComponentOrHook(root)) {
                return;
            }

            const callableAliases = new Map<ts.Symbol, ImportedIdentity>();
            const converterAliases = new Map<ts.Symbol, Converter>();
            const values = new Map<ts.Symbol, ValueInfo>();
            const coverages: Coverage[] = [];
            const coverageKeys = new Set<string>();
            const freshOrigins = new WeakMap<TSESTree.Node, object>();
            const originIds = new WeakMap<object, number>();
            let nextOriginId = 1;
            let resolvedValueCache = new WeakMap<
                TSESTree.Expression,
                ValueInfo | null
            >();

            const topLevelNodes = collectTopLevelRenderNodes(root);
            seedCallableAliases(topLevelNodes, callableAliases);
            const hasRetreeHook = topLevelNodes.some(
                (node) =>
                    node.type === AST_NODE_TYPES.CallExpression &&
                    resolveHookDescriptor(
                        node.callee,
                        callableAliases,
                        normalizedAdditionalHooks
                    ) !== undefined
            );
            if (!hasRetreeHook) {
                return;
            }
            const renderNodes = collectRenderNodes(root, callableAliases);
            const mutatedSymbols = collectMutatedSymbols(renderNodes);

            for (let iteration = 0; iteration < 8; iteration += 1) {
                resolvedValueCache = new WeakMap();
                let changed = false;
                for (const node of renderNodes) {
                    if (node.type === AST_NODE_TYPES.VariableDeclarator) {
                        changed = processVariableDeclarator(node) || changed;
                    }
                    if (node.type === AST_NODE_TYPES.CallExpression) {
                        const coverageCount = coverages.length;
                        resolveHookCall(node);
                        changed = coverages.length !== coverageCount || changed;
                        changed =
                            bindCollectionCallbackParameters(node) || changed;
                    }
                    if (node.type === AST_NODE_TYPES.ForOfStatement) {
                        changed = bindForOfValue(node) || changed;
                    }
                }
                if (!changed) {
                    break;
                }
            }
            resolvedValueCache = new WeakMap();

            const reportedRanges = new Set<string>();
            for (const node of renderNodes) {
                if (node.type === AST_NODE_TYPES.MemberExpression) {
                    if (!isMaximalMemberExpression(node)) {
                        continue;
                    }
                    if (isWriteOnly(node)) {
                        continue;
                    }
                    if (!options.checkJsxKeys && isJsxKeyExpression(node)) {
                        continue;
                    }
                    validateMemberExpression(node, reportedRanges);
                    continue;
                }
                if (node.type === AST_NODE_TYPES.VariableDeclarator) {
                    validateDestructuring(node, reportedRanges);
                    continue;
                }
                if (node.type === AST_NODE_TYPES.ForOfStatement) {
                    validateWholeValueRead(node.right, reportedRanges);
                    continue;
                }
                if (node.type === AST_NODE_TYPES.SpreadElement) {
                    validateWholeValueRead(node.argument, reportedRanges);
                    continue;
                }
                if (node.type === AST_NODE_TYPES.JSXSpreadAttribute) {
                    validateWholeValueRead(node.argument, reportedRanges);
                }
            }

            function seedCallableAliases(
                topLevelNodes: readonly TSESTree.Node[],
                aliases: Map<ts.Symbol, ImportedIdentity>
            ): void {
                for (let iteration = 0; iteration < 4; iteration += 1) {
                    let changed = false;
                    for (const node of topLevelNodes) {
                        if (
                            node.type !== AST_NODE_TYPES.VariableDeclarator ||
                            node.id.type !== AST_NODE_TYPES.Identifier ||
                            node.init === null
                        ) {
                            continue;
                        }
                        const identity = resolveCallableIdentity(
                            node.init,
                            aliases
                        );
                        const symbol = getSymbol(node.id);
                        if (
                            identity !== undefined &&
                            symbol !== undefined &&
                            !aliases.has(symbol)
                        ) {
                            aliases.set(symbol, identity);
                            changed = true;
                        }
                    }
                    if (!changed) {
                        break;
                    }
                }
            }

            function processVariableDeclarator(
                declaration: TSESTree.VariableDeclarator
            ): boolean {
                if (declaration.init === null) {
                    return false;
                }

                let changed = false;
                if (declaration.id.type === AST_NODE_TYPES.Identifier) {
                    const targetSymbol = getSymbol(declaration.id);
                    const callable = resolveCallableIdentity(
                        declaration.init,
                        callableAliases
                    );
                    if (
                        targetSymbol !== undefined &&
                        callable !== undefined &&
                        !callableAliases.has(targetSymbol)
                    ) {
                        callableAliases.set(targetSymbol, callable);
                        changed = true;
                    }

                    const converter = resolveConverter(declaration.init);
                    if (
                        targetSymbol !== undefined &&
                        converter !== undefined &&
                        !converterAliases.has(targetSymbol)
                    ) {
                        converterAliases.set(targetSymbol, converter);
                        changed = true;
                    }
                }

                const value = resolveValue(declaration.init);
                if (value === undefined) {
                    return changed;
                }
                return bindPattern(declaration.id, value) || changed;
            }

            function resolveValue(
                expression: TSESTree.Expression
            ): ValueInfo | undefined {
                const unwrapped = unwrapExpression(expression);
                const cached = resolvedValueCache.get(unwrapped);
                if (cached !== undefined) {
                    return cached ?? undefined;
                }
                const result = resolveValueUncached(unwrapped);
                resolvedValueCache.set(unwrapped, result ?? null);
                return result;
            }

            function resolveValueUncached(
                unwrapped: TSESTree.Expression
            ): ValueInfo | undefined {
                if (unwrapped.type === AST_NODE_TYPES.Identifier) {
                    const symbol = getSymbol(unwrapped);
                    if (symbol === undefined || mutatedSymbols.has(symbol)) {
                        return undefined;
                    }
                    return values.get(symbol);
                }
                if (unwrapped.type === AST_NODE_TYPES.CallExpression) {
                    const hookValue = resolveHookCall(unwrapped);
                    if (hookValue !== undefined) {
                        return hookValue;
                    }
                    const converter = resolveConverter(unwrapped.callee);
                    const firstArgument = unwrapped.arguments[0];
                    if (
                        converter === undefined ||
                        firstArgument === undefined ||
                        firstArgument.type === AST_NODE_TYPES.SpreadElement
                    ) {
                        return undefined;
                    }
                    const rawValue = resolveValue(firstArgument);
                    if (
                        rawValue?.kind !== "provenance" ||
                        !rawValue.raw ||
                        rawValue.origin !== converter.origin ||
                        !pathStartsWith(rawValue.path, converter.rawBasePath)
                    ) {
                        return undefined;
                    }
                    const relativeDepth =
                        rawValue.path.length - converter.rawBasePath.length;
                    if (relativeDepth !== 1) {
                        return undefined;
                    }
                    return {
                        kind: "provenance",
                        origin: rawValue.origin,
                        path: rawValue.path,
                        raw: false,
                    };
                }
                if (unwrapped.type === AST_NODE_TYPES.MemberExpression) {
                    const tupleValue = resolveTupleMember(unwrapped);
                    if (tupleValue !== undefined) {
                        return tupleValue;
                    }
                    const objectValue = resolveValue(unwrapped.object);
                    if (objectValue?.kind !== "provenance") {
                        return undefined;
                    }
                    const key = getMemberKey(unwrapped);
                    if (
                        key === undefined ||
                        !isObjectLike(unwrapped) ||
                        hasUnmodeledRetreeSemantics(unwrapped)
                    ) {
                        return undefined;
                    }
                    return appendPath(objectValue, key);
                }
                if (unwrapped.type === AST_NODE_TYPES.ConditionalExpression) {
                    const consequent = resolveValue(unwrapped.consequent);
                    const alternate = resolveValue(unwrapped.alternate);
                    if (
                        consequent !== undefined &&
                        alternate !== undefined &&
                        sameValue(consequent, alternate)
                    ) {
                        return consequent;
                    }
                }
                return undefined;
            }

            function resolveTupleMember(
                expression: TSESTree.MemberExpression
            ): ValueInfo | undefined {
                const tuple = resolveValue(expression.object);
                if (tuple?.kind !== "tuple") {
                    return undefined;
                }
                const key = getMemberKey(expression);
                if (key === "0") {
                    return tuple.first;
                }
                return undefined;
            }

            function resolveHookCall(
                call: TSESTree.CallExpression
            ): ValueInfo | undefined {
                const descriptor = resolveHookDescriptor(
                    call.callee,
                    callableAliases,
                    normalizedAdditionalHooks
                );
                if (descriptor === undefined) {
                    return undefined;
                }
                if (descriptor.kind === "root") {
                    return {
                        kind: "provenance",
                        origin: getFreshOrigin(call),
                        path: [],
                        raw: false,
                    };
                }

                const firstArgument = call.arguments[0];
                if (
                    firstArgument === undefined ||
                    firstArgument.type === AST_NODE_TYPES.SpreadElement
                ) {
                    return undefined;
                }
                const nodeValue = getObservedArgumentProvenance(
                    firstArgument,
                    call
                );
                if (nodeValue === undefined) {
                    return undefined;
                }

                const coverageKind = getCoverageKind(descriptor, call);
                addCoverage(
                    nodeValue,
                    coverageKind,
                    descriptor.hookName,
                    sourceCode.getText(firstArgument)
                );

                if (descriptor.kind === "raw") {
                    const rawValue: Provenance = {
                        ...nodeValue,
                        raw: true,
                        rawBasePath: nodeValue.path,
                    };
                    if (descriptor.result === "value") {
                        return rawValue;
                    }
                    const converter = descriptor.providesConverter
                        ? {
                              origin: rawValue.origin,
                              rawBasePath: rawValue.path,
                          }
                        : undefined;
                    return { kind: "tuple", first: rawValue, converter };
                }

                const observedValue: Provenance = {
                    ...nodeValue,
                    raw: false,
                    rawBasePath: undefined,
                };
                if (descriptor.result === "tuple-first") {
                    return { kind: "tuple", first: observedValue };
                }
                return observedValue;
            }

            function getObservedArgumentProvenance(
                argument: TSESTree.Expression,
                call: TSESTree.CallExpression
            ): Provenance | undefined {
                const existing = resolveValue(argument);
                if (existing?.kind === "provenance") {
                    if (existing.raw) {
                        return undefined;
                    }
                    return existing;
                }
                const unwrapped = unwrapExpression(argument);
                if (unwrapped.type === AST_NODE_TYPES.Identifier) {
                    const symbol = getSymbol(unwrapped);
                    if (symbol !== undefined) {
                        return {
                            kind: "provenance",
                            origin: symbol,
                            path: [],
                            raw: false,
                        };
                    }
                }
                return {
                    kind: "provenance",
                    origin: getFreshOrigin(call),
                    path: [],
                    raw: false,
                };
            }

            function getCoverageKind(
                descriptor: HookDescriptor,
                call: TSESTree.CallExpression
            ): CoverageKind {
                if (descriptor.configuredCoverage !== undefined) {
                    return descriptor.configuredCoverage;
                }
                if (descriptor.kind === "tree") {
                    return "tree";
                }
                if (descriptor.kind !== "raw") {
                    return "own";
                }
                return rawCallUsesTreeChanged(call) ? "tree" : "own";
            }

            function addCoverage(
                value: Provenance,
                kind: CoverageKind,
                hookName: string,
                observedPath: string
            ): void {
                const originId = getOriginId(value.origin);
                const key = `${originId}:${value.path.join(
                    "/"
                )}:${kind}:${hookName}`;
                if (coverageKeys.has(key)) {
                    return;
                }
                coverageKeys.add(key);
                coverages.push({
                    hookName,
                    kind,
                    observedPath,
                    origin: value.origin,
                    path: value.path,
                });
            }

            function getOriginId(origin: object): number {
                const existing = originIds.get(origin);
                if (existing !== undefined) {
                    return existing;
                }
                const id = nextOriginId;
                nextOriginId += 1;
                originIds.set(origin, id);
                return id;
            }

            function getFreshOrigin(node: TSESTree.Node): object {
                const existing = freshOrigins.get(node);
                if (existing !== undefined) {
                    return existing;
                }
                const origin = {};
                freshOrigins.set(node, origin);
                return origin;
            }

            function bindPattern(
                pattern: TSESTree.BindingName,
                value: ValueInfo
            ): boolean {
                if (pattern.type === AST_NODE_TYPES.Identifier) {
                    const symbol = getSymbol(pattern);
                    if (
                        symbol === undefined ||
                        mutatedSymbols.has(symbol) ||
                        sameValue(values.get(symbol), value)
                    ) {
                        return false;
                    }
                    values.set(symbol, value);
                    return true;
                }
                if (pattern.type === AST_NODE_TYPES.ArrayPattern) {
                    if (value.kind === "tuple") {
                        let changed = false;
                        const first = pattern.elements[0];
                        if (first !== null) {
                            changed =
                                bindPatternElement(first, value.first) ||
                                changed;
                        }
                        const second = pattern.elements[1];
                        if (
                            second?.type === AST_NODE_TYPES.Identifier &&
                            value.converter !== undefined
                        ) {
                            const symbol = getSymbol(second);
                            if (
                                symbol !== undefined &&
                                !converterAliases.has(symbol)
                            ) {
                                converterAliases.set(symbol, value.converter);
                                changed = true;
                            }
                        }
                        return changed;
                    }
                    return false;
                }
                if (
                    pattern.type === AST_NODE_TYPES.ObjectPattern &&
                    value.kind === "provenance"
                ) {
                    let changed = false;
                    for (const property of pattern.properties) {
                        if (property.type !== AST_NODE_TYPES.Property) {
                            continue;
                        }
                        const key = getPropertyKey(property);
                        if (key === undefined) {
                            continue;
                        }
                        if (!isObjectLike(property.value)) {
                            continue;
                        }
                        changed =
                            bindPatternElement(
                                property.value,
                                appendPath(value, key)
                            ) || changed;
                    }
                    return changed;
                }
                return false;
            }

            function bindPatternElement(
                pattern: TSESTree.Node,
                value: ValueInfo
            ): boolean {
                if (pattern.type === AST_NODE_TYPES.RestElement) {
                    return false;
                }
                if (pattern.type === AST_NODE_TYPES.AssignmentPattern) {
                    return bindPatternElement(pattern.left, value);
                }
                if (
                    pattern.type !== AST_NODE_TYPES.Identifier &&
                    pattern.type !== AST_NODE_TYPES.ArrayPattern &&
                    pattern.type !== AST_NODE_TYPES.ObjectPattern
                ) {
                    return false;
                }
                return bindPattern(pattern, value);
            }

            function resolveConverter(
                expression: TSESTree.Expression | TSESTree.PrivateIdentifier
            ): Converter | undefined {
                if (expression.type !== AST_NODE_TYPES.Identifier) {
                    return undefined;
                }
                const symbol = getSymbol(expression);
                if (symbol === undefined || mutatedSymbols.has(symbol)) {
                    return undefined;
                }
                return converterAliases.get(symbol);
            }

            function bindCollectionCallbackParameters(
                call: TSESTree.CallExpression
            ): boolean {
                if (
                    call.callee.type !== AST_NODE_TYPES.MemberExpression ||
                    !isArrayLike(call.callee.object)
                ) {
                    return false;
                }
                const methodName = getMemberKey(call.callee);
                if (
                    methodName === undefined ||
                    !synchronousArrayMethods.has(methodName)
                ) {
                    return false;
                }
                const collection = resolveValue(call.callee.object);
                if (collection?.kind !== "provenance") {
                    return false;
                }
                const callback = call.arguments[0];
                if (callback === undefined || !isFunctionNode(callback)) {
                    return false;
                }
                const element = appendPath(collection, "*");
                let changed = false;
                const elementParameterIndex = methodName.startsWith("reduce")
                    ? 1
                    : 0;
                const elementParameter = callback.params[elementParameterIndex];
                if (
                    elementParameter !== undefined &&
                    elementParameter.type !== AST_NODE_TYPES.TSParameterProperty
                ) {
                    changed =
                        bindPatternElement(elementParameter, element) ||
                        changed;
                }
                return changed;
            }

            function bindForOfValue(
                statement: TSESTree.ForOfStatement
            ): boolean {
                const collection = resolveValue(statement.right);
                if (collection?.kind !== "provenance") {
                    return false;
                }
                const element = appendPath(collection, "*");
                if (
                    statement.left.type === AST_NODE_TYPES.VariableDeclaration
                ) {
                    const declaration = statement.left.declarations[0];
                    if (declaration === undefined) {
                        return false;
                    }
                    return bindPattern(declaration.id, element);
                }
                if (statement.left.type === AST_NODE_TYPES.Identifier) {
                    return bindPattern(statement.left, element);
                }
                return false;
            }

            function validateMemberExpression(
                expression: TSESTree.MemberExpression,
                reported: Set<string>
            ): void {
                const flattened = flattenMemberExpression(expression);
                if (flattened === undefined) {
                    return;
                }
                const baseValue = resolveValue(flattened.base);
                if (baseValue?.kind !== "provenance") {
                    return;
                }

                let current = baseValue;
                for (const segment of flattened.segments) {
                    const coveringObservation =
                        findCoveringObservation(current);
                    if (coveringObservation === undefined) {
                        reportMissingCoverage(
                            expression,
                            segment,
                            current,
                            reported
                        );
                        return;
                    }
                    if (hasUnmodeledRetreeSemantics(segment.node)) {
                        return;
                    }
                    if (!isObjectLike(segment.node)) {
                        return;
                    }
                    current = appendPath(current, segment.key);
                }
            }

            function validateDestructuring(
                declaration: TSESTree.VariableDeclarator,
                reported: Set<string>
            ): void {
                if (
                    declaration.init === null ||
                    declaration.id.type !== AST_NODE_TYPES.ObjectPattern
                ) {
                    return;
                }
                const value = resolveValue(declaration.init);
                if (value?.kind !== "provenance") {
                    return;
                }
                validateObjectPattern(
                    declaration.id,
                    value,
                    reported,
                    sourceCode.getText(declaration.init)
                );
            }

            function validateWholeValueRead(
                expression: TSESTree.Expression,
                reported: Set<string>
            ): void {
                const value = resolveValue(expression);
                if (value?.kind !== "provenance") {
                    return;
                }
                if (findCoveringObservation(value) !== undefined) {
                    return;
                }
                const rangeKey = `${expression.range[0]}:${expression.range[1]}`;
                if (reported.has(rangeKey)) {
                    return;
                }
                reported.add(rangeKey);
                const expressionText = sourceCode.getText(expression);
                reportForProvenance(
                    expression,
                    expressionText,
                    expressionText,
                    value
                );
            }

            function validateObjectPattern(
                pattern: TSESTree.ObjectPattern,
                value: Provenance,
                reported: Set<string>,
                baseText = "the destructured value"
            ): void {
                for (const property of pattern.properties) {
                    if (property.type !== AST_NODE_TYPES.Property) {
                        continue;
                    }
                    const key = getPropertyKey(property);
                    if (key === undefined) {
                        continue;
                    }
                    if (findCoveringObservation(value) === undefined) {
                        const rangeKey = `${property.range[0]}:${property.range[1]}`;
                        if (reported.has(rangeKey)) {
                            continue;
                        }
                        reported.add(rangeKey);
                        reportForProvenance(
                            property.key,
                            sourceCode.getText(property),
                            baseText,
                            value
                        );
                        continue;
                    }
                    if (
                        property.value.type === AST_NODE_TYPES.ObjectPattern &&
                        isObjectLike(property.value)
                    ) {
                        validateObjectPattern(
                            property.value,
                            appendPath(value, key),
                            reported,
                            sourceCode.getText(property.value)
                        );
                    }
                }
            }

            function reportMissingCoverage(
                maximalExpression: TSESTree.MemberExpression,
                segment: MemberSegment,
                owner: Provenance,
                reported: Set<string>
            ): void {
                let reportNode: TSESTree.Node = segment.node.property;
                let readPath = sourceCode.getText(maximalExpression);
                const parent = getParent(maximalExpression);
                if (
                    parent?.type === AST_NODE_TYPES.CallExpression &&
                    parent.callee === maximalExpression &&
                    synchronousArrayMethods.has(segment.key)
                ) {
                    reportNode = segment.node.object;
                    readPath = sourceCode.getText(segment.node.object);
                }
                const rangeKey = `${reportNode.range[0]}:${reportNode.range[1]}`;
                if (reported.has(rangeKey)) {
                    return;
                }
                reported.add(rangeKey);
                reportForProvenance(
                    reportNode,
                    readPath,
                    sourceCode.getText(segment.node.object),
                    owner
                );
            }

            function reportForProvenance(
                node: TSESTree.Node,
                readPath: string,
                ownerPath: string,
                owner: Provenance
            ): void {
                const nearest = findNearestObservation(owner);
                if (owner.raw) {
                    const rawBasePath = owner.rawBasePath ?? [];
                    const relativeDepth =
                        owner.path.length - rawBasePath.length;
                    if (relativeDepth === 1) {
                        context.report({
                            node,
                            messageId: "unobservedDirectRawChildRead",
                            data: {
                                observedPath:
                                    nearest?.observedPath ?? "the raw node",
                                rawOwnerPath: ownerPath,
                                readPath,
                            },
                        });
                        return;
                    }
                    context.report({
                        node,
                        messageId: "unobservedRawRead",
                        data: {
                            observedPath:
                                nearest?.observedPath ?? "the raw node",
                            rawOwnerPath: ownerPath,
                            readPath,
                        },
                    });
                    return;
                }
                context.report({
                    node,
                    messageId: "unobservedNodeRead",
                    data: {
                        observedPath:
                            nearest?.observedPath ?? "the managed origin",
                        observingHook: nearest?.hookName ?? "none",
                        ownerPath,
                        readPath,
                    },
                });
            }

            function findCoveringObservation(
                value: Provenance
            ): Coverage | undefined {
                let best: Coverage | undefined;
                for (const coverage of coverages) {
                    if (coverage.origin !== value.origin) {
                        continue;
                    }
                    const covers =
                        (coverage.kind === "own" &&
                            samePath(coverage.path, value.path)) ||
                        (coverage.kind === "tree" &&
                            pathStartsWith(value.path, coverage.path));
                    if (
                        covers &&
                        (best === undefined ||
                            coverage.path.length > best.path.length)
                    ) {
                        best = coverage;
                    }
                }
                return best;
            }

            function findNearestObservation(
                value: Provenance
            ): Coverage | undefined {
                let best: Coverage | undefined;
                for (const coverage of coverages) {
                    if (
                        coverage.origin !== value.origin ||
                        !pathStartsWith(value.path, coverage.path)
                    ) {
                        continue;
                    }
                    if (
                        best === undefined ||
                        coverage.path.length > best.path.length
                    ) {
                        best = coverage;
                    }
                }
                return best;
            }
        }

        return {
            Program(program): void {
                collectImports(program);
            },
            FunctionDeclaration(node): void {
                functionNodes.push(node);
            },
            FunctionExpression(node): void {
                functionNodes.push(node);
            },
            ArrowFunctionExpression(node): void {
                functionNodes.push(node);
            },
            "Program:exit"(): void {
                for (const functionNode of functionNodes) {
                    analyzeFunction(functionNode);
                }
            },
        };

        function collectTopLevelRenderNodes(
            root: FunctionNode
        ): TSESTree.Node[] {
            const nodes: TSESTree.Node[] = [];
            walkNode(root.body, (node) => nodes.push(node), true);
            return nodes;
        }

        function collectRenderNodes(
            root: FunctionNode,
            callableAliases: Map<ts.Symbol, ImportedIdentity>
        ): TSESTree.Node[] {
            const nodes: TSESTree.Node[] = [];
            walkRenderNode(root.body);
            return nodes;

            function walkRenderNode(node: TSESTree.Node): void {
                nodes.push(node);
                if (isFunctionNode(node)) {
                    return;
                }
                if (node.type === AST_NODE_TYPES.CallExpression) {
                    walkCall(node);
                    return;
                }
                for (const child of getChildren(node)) {
                    walkRenderNode(child);
                }
            }

            function walkCall(call: TSESTree.CallExpression): void {
                if (isFunctionNode(call.callee)) {
                    walkRenderNode(call.callee.body);
                } else {
                    walkRenderNode(call.callee);
                }
                for (let index = 0; index < call.arguments.length; index += 1) {
                    const argument = call.arguments[index];
                    if (argument.type === AST_NODE_TYPES.SpreadElement) {
                        walkRenderNode(argument.argument);
                        continue;
                    }
                    if (!isFunctionNode(argument)) {
                        walkRenderNode(argument);
                        continue;
                    }
                    if (
                        isSynchronousRenderCallback(
                            call,
                            index,
                            callableAliases
                        )
                    ) {
                        walkRenderNode(argument.body);
                    }
                }
            }
        }

        function isSynchronousRenderCallback(
            call: TSESTree.CallExpression,
            argumentIndex: number,
            callableAliases: Map<ts.Symbol, ImportedIdentity>
        ): boolean {
            if (argumentIndex !== 0) {
                return false;
            }
            const callable = resolveCallableIdentity(
                call.callee,
                callableAliases
            );
            if (
                callable?.moduleName === "react" &&
                callable.exportName === "useMemo"
            ) {
                return true;
            }
            if (
                call.callee.type !== AST_NODE_TYPES.MemberExpression ||
                !isArrayLike(call.callee.object)
            ) {
                return false;
            }
            const methodName = getMemberKey(call.callee);
            return (
                methodName !== undefined &&
                synchronousArrayMethods.has(methodName)
            );
        }

        function isArrayLike(expression: TSESTree.Expression): boolean {
            const cached = arrayLikeCache.get(expression);
            if (cached !== undefined) {
                return cached;
            }
            const tsNode = services.esTreeNodeToTSNodeMap.get(expression);
            const type = checker.getTypeAtLocation(tsNode);
            const result =
                checker.isArrayType(type) || checker.isTupleType(type);
            arrayLikeCache.set(expression, result);
            return result;
        }

        function isObjectLike(node: TSESTree.Node): boolean {
            const cached = objectLikeCache.get(node);
            if (cached !== undefined) {
                return cached;
            }
            const tsNode = services.esTreeNodeToTSNodeMap.get(node);
            const result = typeIsObjectLike(checker.getTypeAtLocation(tsNode));
            objectLikeCache.set(node, result);
            return result;
        }

        function typeIsObjectLike(type: ts.Type): boolean {
            if (
                (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !==
                0
            ) {
                return false;
            }
            if (type.isUnion()) {
                const relevantTypes = type.types.filter(
                    (part) =>
                        (part.flags &
                            (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) ===
                        0
                );
                return (
                    relevantTypes.length > 0 &&
                    relevantTypes.every(typeIsObjectLike)
                );
            }
            if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
                const constraint = checker.getBaseConstraintOfType(type);
                return constraint !== undefined && typeIsObjectLike(constraint);
            }
            if ((type.flags & ts.TypeFlags.Object) === 0) {
                return false;
            }
            return type.getCallSignatures().length === 0;
        }

        function hasUnmodeledRetreeSemantics(
            member: TSESTree.MemberExpression
        ): boolean {
            const cached = unmodeledSemanticsCache.get(member);
            if (cached !== undefined) {
                return cached;
            }
            const objectNode = services.esTreeNodeToTSNodeMap.get(
                member.object
            );
            const objectType = checker.getTypeAtLocation(objectNode);
            if (typeIsReactiveNode(objectType)) {
                unmodeledSemanticsCache.set(member, true);
                return true;
            }

            const propertyNode = services.esTreeNodeToTSNodeMap.get(
                member.property
            );
            const propertySymbol = checker.getSymbolAtLocation(propertyNode);
            const result = (propertySymbol?.declarations ?? []).some(
                (declaration) => {
                    if (!ts.canHaveDecorators(declaration)) {
                        return false;
                    }
                    return (ts.getDecorators(declaration)?.length ?? 0) > 0;
                }
            );
            unmodeledSemanticsCache.set(member, result);
            return result;
        }

        function typeIsReactiveNode(type: ts.Type): boolean {
            const cached = reactiveNodeTypeCache.get(type);
            if (cached !== undefined) {
                return cached;
            }
            let result: boolean;
            if (type.isUnionOrIntersection()) {
                result = type.types.some(typeIsReactiveNode);
            } else if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
                const constraint = checker.getBaseConstraintOfType(type);
                result =
                    constraint !== undefined && typeIsReactiveNode(constraint);
            } else {
                discoverReactiveNodeType(type, 0, new Set());
                result = typeDerivesFromReactiveNode(type, new Set());
            }
            if (reactiveNodeSymbol !== undefined) {
                reactiveNodeTypeCache.set(type, result);
            }
            return result;
        }

        function typeDerivesFromReactiveNode(
            type: ts.Type,
            visited: Set<ts.Type>
        ): boolean {
            if (reactiveNodeSymbol === undefined || visited.has(type)) {
                return false;
            }
            visited.add(type);
            // Deliberately compare canonical class/base symbols instead of
            // checker.isTypeAssignableTo. ReactiveNode's protected onChanged
            // currently makes structural assignability nominal, but making
            // that member public in a future core refactor must not widen this
            // bailout to application objects with a similar public shape.
            const symbol = type.aliasSymbol ?? type.getSymbol();
            if (symbol === reactiveNodeSymbol) {
                return true;
            }
            if ((type.flags & ts.TypeFlags.Object) === 0) {
                return false;
            }
            const objectType = type as ts.ObjectType;
            if (
                (objectType.objectFlags & ts.ObjectFlags.ClassOrInterface) ===
                0
            ) {
                return false;
            }
            return ((type as ts.InterfaceType).getBaseTypes() ?? []).some(
                (baseType) => typeDerivesFromReactiveNode(baseType, visited)
            );
        }

        function discoverReactiveNodeType(
            type: ts.Type,
            depth: number,
            visited: Set<ts.Type>
        ): void {
            if (
                reactiveNodeSymbol !== undefined ||
                depth > 4 ||
                visited.has(type)
            ) {
                return;
            }
            visited.add(type);

            const symbol = type.aliasSymbol ?? type.getSymbol();
            const baseTypes = getClassOrInterfaceBaseTypes(type);
            const candidateSymbols = [
                symbol,
                ...baseTypes.map(
                    (baseType) => baseType.aliasSymbol ?? baseType.getSymbol()
                ),
            ].filter((candidate) => candidate !== undefined);
            for (const declaration of symbol?.declarations ?? []) {
                for (const candidateSymbol of candidateSymbols) {
                    resolveReactiveNodeTypeFromSourceFile(
                        declaration.getSourceFile(),
                        candidateSymbol
                    );
                    if (reactiveNodeSymbol !== undefined) {
                        return;
                    }
                }
            }

            for (const baseType of baseTypes) {
                discoverReactiveNodeType(baseType, depth + 1, visited);
                if (reactiveNodeSymbol !== undefined) {
                    return;
                }
            }
        }

        function getClassOrInterfaceBaseTypes(
            type: ts.Type
        ): readonly ts.BaseType[] {
            if ((type.flags & ts.TypeFlags.Object) === 0) {
                return [];
            }
            const objectType = type as ts.ObjectType;
            if (
                (objectType.objectFlags & ts.ObjectFlags.ClassOrInterface) ===
                0
            ) {
                return [];
            }
            return (type as ts.InterfaceType).getBaseTypes() ?? [];
        }

        function resolveReactiveNodeTypeFromSourceFile(
            sourceFile: ts.SourceFile,
            candidateSymbol: ts.Symbol
        ): void {
            if (reactiveNodeSymbol !== undefined) {
                return;
            }
            const inspectedSymbols =
                inspectedReactiveNodeCandidates.get(sourceFile) ?? new Set();
            if (inspectedSymbols.has(candidateSymbol)) {
                return;
            }
            inspectedSymbols.add(candidateSymbol);
            inspectedReactiveNodeCandidates.set(sourceFile, inspectedSymbols);

            const visitedModules = new Set<ts.Symbol>();
            for (const statement of sourceFile.statements) {
                if (
                    !ts.isImportDeclaration(statement) &&
                    !ts.isExportDeclaration(statement)
                ) {
                    continue;
                }
                const moduleSpecifier = statement.moduleSpecifier;
                if (
                    moduleSpecifier === undefined ||
                    !ts.isStringLiteral(moduleSpecifier)
                ) {
                    continue;
                }
                const moduleSymbol =
                    checker.getSymbolAtLocation(moduleSpecifier);
                if (
                    moduleSymbol === undefined ||
                    !moduleExportsSymbol(moduleSymbol, candidateSymbol)
                ) {
                    continue;
                }
                if (
                    moduleSpecifier.text === RETREE_CORE_MODULE ||
                    moduleReexportsCoreSymbol(
                        moduleSymbol,
                        candidateSymbol,
                        1,
                        visitedModules
                    )
                ) {
                    reactiveNodeSymbol = candidateSymbol;
                    return;
                }
            }
        }

        function moduleReexportsCoreSymbol(
            moduleSymbol: ts.Symbol,
            candidateSymbol: ts.Symbol,
            depth: number,
            visited: Set<ts.Symbol>
        ): boolean {
            if (depth >= 4 || visited.has(moduleSymbol)) {
                return false;
            }
            visited.add(moduleSymbol);
            for (const declaration of moduleSymbol.declarations ?? []) {
                for (const statement of declaration.getSourceFile()
                    .statements) {
                    if (
                        !ts.isImportDeclaration(statement) &&
                        !ts.isExportDeclaration(statement)
                    ) {
                        continue;
                    }
                    const moduleSpecifier = statement.moduleSpecifier;
                    if (
                        moduleSpecifier === undefined ||
                        !ts.isStringLiteral(moduleSpecifier)
                    ) {
                        continue;
                    }
                    const nextModuleSymbol =
                        checker.getSymbolAtLocation(moduleSpecifier);
                    if (
                        nextModuleSymbol === undefined ||
                        !moduleExportsSymbol(nextModuleSymbol, candidateSymbol)
                    ) {
                        continue;
                    }
                    if (
                        moduleSpecifier.text === RETREE_CORE_MODULE &&
                        moduleExportsNamedSymbol(
                            nextModuleSymbol,
                            "ReactiveNode",
                            candidateSymbol
                        )
                    ) {
                        return true;
                    }
                    if (
                        moduleReexportsCoreSymbol(
                            nextModuleSymbol,
                            candidateSymbol,
                            depth + 1,
                            visited
                        )
                    ) {
                        return true;
                    }
                }
            }
            return false;
        }

        function resolveReactiveNodeTypeFromImportedModule(
            moduleSymbol: ts.Symbol | undefined
        ): void {
            if (
                moduleSymbol === undefined ||
                reactiveNodeSymbol !== undefined
            ) {
                return;
            }
            for (const exportedSymbol of checker.getExportsOfModule(
                moduleSymbol
            )) {
                const candidateSymbol = resolveAlias(exportedSymbol);
                if (candidateSymbol === undefined) {
                    continue;
                }
                if (
                    moduleReexportsCoreSymbol(
                        moduleSymbol,
                        candidateSymbol,
                        0,
                        new Set()
                    )
                ) {
                    reactiveNodeSymbol = candidateSymbol;
                    return;
                }
            }
        }

        function moduleExportsSymbol(
            moduleSymbol: ts.Symbol,
            candidateSymbol: ts.Symbol
        ): boolean {
            return checker
                .getExportsOfModule(moduleSymbol)
                .some(
                    (exportedSymbol) =>
                        resolveAlias(exportedSymbol) === candidateSymbol
                );
        }

        function moduleExportsNamedSymbol(
            moduleSymbol: ts.Symbol,
            exportName: string,
            candidateSymbol: ts.Symbol
        ): boolean {
            const exportedSymbol = checker
                .getExportsOfModule(moduleSymbol)
                .find((candidate) => candidate.name === exportName);
            if (exportedSymbol === undefined) {
                return false;
            }
            return resolveAlias(exportedSymbol) === candidateSymbol;
        }

        function resolveReactiveNodeTypeFromModuleSymbol(
            moduleSymbol: ts.Symbol | undefined
        ): void {
            if (
                moduleSymbol === undefined ||
                reactiveNodeSymbol !== undefined
            ) {
                return;
            }
            const exportedSymbol = checker
                .getExportsOfModule(moduleSymbol)
                .find((candidate) => candidate.getName() === "ReactiveNode");
            if (exportedSymbol === undefined) {
                return;
            }
            const canonicalSymbol = resolveAlias(exportedSymbol);
            if (canonicalSymbol === undefined) {
                return;
            }
            reactiveNodeSymbol = canonicalSymbol;
        }

        function resolveCallableIdentity(
            expression: TSESTree.Expression | TSESTree.PrivateIdentifier,
            callableAliases: Map<ts.Symbol, ImportedIdentity>
        ): ImportedIdentity | undefined {
            if (expression.type === AST_NODE_TYPES.Identifier) {
                const symbol = getSymbol(expression);
                if (symbol === undefined) {
                    return undefined;
                }
                return (
                    callableAliases.get(symbol) ??
                    importedIdentities.get(symbol)
                );
            }
            if (expression.type !== AST_NODE_TYPES.MemberExpression) {
                return undefined;
            }
            const propertyName = getMemberKey(expression);
            if (propertyName === undefined) {
                return undefined;
            }
            const object = unwrapExpression(expression.object);
            if (object.type === AST_NODE_TYPES.Identifier) {
                const objectSymbol = getSymbol(object);
                if (objectSymbol === undefined) {
                    return undefined;
                }
                const namespace = importedNamespaces.get(objectSymbol);
                if (namespace !== undefined) {
                    return {
                        ...namespace,
                        exportName: propertyName,
                    };
                }
                const importedObject =
                    callableAliases.get(objectSymbol) ??
                    importedIdentities.get(objectSymbol);
                if (importedObject !== undefined) {
                    return {
                        ...importedObject,
                        exportName: `${importedObject.exportName}.${propertyName}`,
                    };
                }
            }
            const importedObject = resolveCallableIdentity(
                object,
                callableAliases
            );
            if (importedObject !== undefined) {
                return {
                    ...importedObject,
                    exportName: `${importedObject.exportName}.${propertyName}`,
                };
            }
            return undefined;
        }

        function resolveHookDescriptor(
            callee: TSESTree.Expression | TSESTree.PrivateIdentifier,
            callableAliases: Map<ts.Symbol, ImportedIdentity>,
            additionalHooks: readonly NormalizedAdditionalHook[]
        ): HookDescriptor | undefined {
            const identity = resolveCallableIdentity(callee, callableAliases);
            if (identity === undefined) {
                return undefined;
            }
            if (identity.moduleName === RETREE_REACT_MODULE) {
                if (identity.exportName === "useNode") {
                    return {
                        hookName: "useNode",
                        kind: "node",
                        result: "value",
                    };
                }
                if (identity.exportName === "useTree") {
                    return {
                        hookName: "useTree",
                        kind: "tree",
                        result: "value",
                    };
                }
                if (identity.exportName === "useRaw") {
                    return {
                        hookName: "useRaw",
                        kind: "raw",
                        providesConverter: true,
                        result: "tuple-first",
                    };
                }
                if (identity.exportName === "useRoot") {
                    return {
                        hookName: "useRoot",
                        kind: "root",
                        result: "value",
                    };
                }
            }
            if (
                identity.moduleName === RETREE_CORE_MODULE &&
                identity.exportName === "Retree.root"
            ) {
                return {
                    hookName: "Retree.root",
                    kind: "root",
                    result: "value",
                };
            }

            const configured = additionalHooks.find((hook) => {
                if (hook.exportName !== identity.exportName) {
                    return false;
                }
                if (hook.targetKind === "package") {
                    return hook.target === identity.moduleName;
                }
                return (
                    identity.resolvedFileName !== undefined &&
                    hook.target === identity.resolvedFileName
                );
            });
            if (configured === undefined) {
                return undefined;
            }
            const raw = configured.observes.startsWith("raw-");
            const tree = configured.observes.endsWith("tree");
            return {
                configuredCoverage: tree ? "tree" : "own",
                hookName: configured.exportName,
                kind: raw ? "raw" : tree ? "tree" : "node",
                result: configured.result ?? "value",
            };
        }

        function rawCallUsesTreeChanged(
            call: TSESTree.CallExpression
        ): boolean {
            const optionsArgument = call.arguments[1];
            if (
                optionsArgument === undefined ||
                optionsArgument.type !== AST_NODE_TYPES.ObjectExpression
            ) {
                return false;
            }
            for (const property of optionsArgument.properties) {
                if (property.type !== AST_NODE_TYPES.Property) {
                    continue;
                }
                if (getPropertyKey(property) !== "listenerType") {
                    continue;
                }
                return (
                    property.value.type === AST_NODE_TYPES.Literal &&
                    property.value.value === "treeChanged"
                );
            }
            return false;
        }

        function collectMutatedSymbols(
            nodes: readonly TSESTree.Node[]
        ): Set<ts.Symbol> {
            const mutated = new Set<ts.Symbol>();
            for (const node of nodes) {
                if (node.type === AST_NODE_TYPES.AssignmentExpression) {
                    collectAssignedSymbols(node.left, mutated);
                }
                if (node.type === AST_NODE_TYPES.UpdateExpression) {
                    collectAssignedSymbols(node.argument, mutated);
                }
            }
            return mutated;
        }

        function collectAssignedSymbols(
            node: TSESTree.Node,
            symbols: Set<ts.Symbol>
        ): void {
            if (node.type === AST_NODE_TYPES.Identifier) {
                const symbol = getSymbol(node);
                if (symbol !== undefined) {
                    symbols.add(symbol);
                }
                return;
            }
            for (const child of getChildren(node)) {
                collectAssignedSymbols(child, symbols);
            }
        }

        function isComponentOrHook(node: FunctionNode): boolean {
            const name = getFunctionName(node);
            if (name === undefined) {
                return false;
            }
            return /^[A-Z]/.test(name) || /^use[A-Z0-9]/.test(name);
        }

        function getFunctionName(node: FunctionNode): string | undefined {
            if (node.id?.name !== undefined) {
                return node.id.name;
            }
            let parent = getParent(node);
            if (
                parent?.type === AST_NODE_TYPES.CallExpression &&
                parent.arguments.some((argument) => argument === node)
            ) {
                parent = getParent(parent);
            }
            if (
                parent?.type === AST_NODE_TYPES.VariableDeclarator &&
                parent.id.type === AST_NODE_TYPES.Identifier
            ) {
                return parent.id.name;
            }
            return undefined;
        }

        function getChildren(node: TSESTree.Node): TSESTree.Node[] {
            const keys = sourceCode.visitorKeys[node.type] ?? [];
            const children: TSESTree.Node[] = [];
            const record = node as unknown as Record<string, unknown>;
            for (const key of keys) {
                const value = record[key];
                if (Array.isArray(value)) {
                    for (const item of value) {
                        if (isNode(item)) {
                            children.push(item);
                        }
                    }
                    continue;
                }
                if (isNode(value)) {
                    children.push(value);
                }
            }
            return children;
        }

        function walkNode(
            node: TSESTree.Node,
            visit: (node: TSESTree.Node) => void,
            stopAtFunctions: boolean
        ): void {
            visit(node);
            if (stopAtFunctions && isFunctionNode(node)) {
                return;
            }
            for (const child of getChildren(node)) {
                walkNode(child, visit, stopAtFunctions);
            }
        }
    },
});

function normalizeAdditionalHooks(
    options: NoUnobservedReactReadOptions
): NormalizedAdditionalHook[] {
    if (
        options.baseDirectory !== undefined &&
        !path.isAbsolute(options.baseDirectory)
    ) {
        throw new Error(
            `@retreejs/no-unobserved-react-read: baseDirectory must be absolute; received "${options.baseDirectory}".`
        );
    }

    return (options.additionalHooks ?? []).map((hook, index) => {
        if ("file" in hook) {
            if (
                !path.isAbsolute(hook.file) &&
                options.baseDirectory === undefined
            ) {
                throw new Error(
                    `@retreejs/no-unobserved-react-read: additionalHooks[${index}].file is relative ("${hook.file}"), but baseDirectory is not configured. Fix: provide an absolute file path or set baseDirectory to an absolute path.`
                );
            }
            const target = path.isAbsolute(hook.file)
                ? hook.file
                : path.resolve(options.baseDirectory!, hook.file);
            return {
                exportName: hook.export,
                observes: hook.observes,
                result: hook.result,
                target: normalizeFileName(target),
                targetKind: "file",
            };
        }
        return {
            exportName: hook.export,
            observes: hook.observes,
            result: hook.result,
            target: hook.package,
            targetKind: "package",
        };
    });
}

function normalizeFileName(fileName: string): string {
    const normalized = path.normalize(fileName);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function getImportName(
    imported: TSESTree.Identifier | TSESTree.StringLiteral
): string {
    return imported.type === AST_NODE_TYPES.Identifier
        ? imported.name
        : String(imported.value);
}

function unwrapExpression(
    expression: TSESTree.Expression
): TSESTree.Expression {
    let current = expression;
    while (transparentExpressionTypes.has(current.type)) {
        current = (
            current as
                | TSESTree.ChainExpression
                | TSESTree.TSAsExpression
                | TSESTree.TSNonNullExpression
                | TSESTree.TSTypeAssertion
        ).expression;
    }
    return current;
}

function getMemberKey(member: TSESTree.MemberExpression): string | undefined {
    if (
        !member.computed &&
        member.property.type === AST_NODE_TYPES.Identifier
    ) {
        return member.property.name;
    }
    if (member.property.type === AST_NODE_TYPES.Literal) {
        if (
            typeof member.property.value === "string" ||
            typeof member.property.value === "number"
        ) {
            return String(member.property.value);
        }
    }
    if (
        member.property.type === AST_NODE_TYPES.TemplateLiteral &&
        member.property.expressions.length === 0
    ) {
        return member.property.quasis[0]?.value.cooked ?? undefined;
    }
    return undefined;
}

function getPropertyKey(property: TSESTree.Property): string | undefined {
    if (!property.computed && property.key.type === AST_NODE_TYPES.Identifier) {
        return property.key.name;
    }
    if (property.key.type === AST_NODE_TYPES.Literal) {
        if (
            typeof property.key.value === "string" ||
            typeof property.key.value === "number"
        ) {
            return String(property.key.value);
        }
    }
    return undefined;
}

function appendPath(value: Provenance, segment: string): Provenance {
    return {
        ...value,
        path: [...value.path, segment],
    };
}

function sameValue(
    left: ValueInfo | undefined,
    right: ValueInfo | undefined
): boolean {
    if (left === undefined || right === undefined || left.kind !== right.kind) {
        return left === right;
    }
    if (left.kind === "provenance" && right.kind === "provenance") {
        return (
            left.origin === right.origin &&
            left.raw === right.raw &&
            samePath(left.path, right.path) &&
            ((left.rawBasePath === undefined &&
                right.rawBasePath === undefined) ||
                (left.rawBasePath !== undefined &&
                    right.rawBasePath !== undefined &&
                    samePath(left.rawBasePath, right.rawBasePath)))
        );
    }
    if (left.kind === "tuple" && right.kind === "tuple") {
        return (
            sameValue(left.first, right.first) &&
            left.converter?.origin === right.converter?.origin &&
            ((left.converter === undefined && right.converter === undefined) ||
                (left.converter !== undefined &&
                    right.converter !== undefined &&
                    samePath(
                        left.converter.rawBasePath,
                        right.converter.rawBasePath
                    )))
        );
    }
    return false;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
    return (
        left.length === right.length &&
        left.every((segment, index) => segment === right[index])
    );
}

function pathStartsWith(
    pathValue: readonly string[],
    prefix: readonly string[]
): boolean {
    return (
        prefix.length <= pathValue.length &&
        prefix.every((segment, index) => segment === pathValue[index])
    );
}

function flattenMemberExpression(
    expression: TSESTree.MemberExpression
): { base: TSESTree.Expression; segments: MemberSegment[] } | undefined {
    const segments: MemberSegment[] = [];
    let current: TSESTree.Expression = expression;
    while (true) {
        const unwrapped = unwrapExpression(current);
        if (unwrapped.type !== AST_NODE_TYPES.MemberExpression) {
            return { base: unwrapped, segments };
        }
        const key = getMemberKey(unwrapped);
        if (key === undefined) {
            return undefined;
        }
        segments.unshift({ key, node: unwrapped });
        current = unwrapped.object;
    }
}

function isMaximalMemberExpression(
    expression: TSESTree.MemberExpression
): boolean {
    let parent = getParent(expression);
    while (
        parent !== undefined &&
        transparentExpressionTypes.has(parent.type)
    ) {
        parent = getParent(parent);
    }
    return !(
        parent?.type === AST_NODE_TYPES.MemberExpression &&
        unwrapExpression(parent.object) === expression
    );
}

function isWriteOnly(expression: TSESTree.MemberExpression): boolean {
    let current: TSESTree.Node = expression;
    let parent = getParent(current);
    while (
        parent !== undefined &&
        transparentExpressionTypes.has(parent.type)
    ) {
        current = parent;
        parent = getParent(current);
    }
    return (
        parent?.type === AST_NODE_TYPES.AssignmentExpression &&
        parent.left === current &&
        parent.operator === "="
    );
}

function isJsxKeyExpression(expression: TSESTree.MemberExpression): boolean {
    let current: TSESTree.Node = expression;
    let parent = getParent(current);
    while (
        parent !== undefined &&
        transparentExpressionTypes.has(parent.type)
    ) {
        current = parent;
        parent = getParent(current);
    }
    if (
        parent?.type !== AST_NODE_TYPES.JSXExpressionContainer ||
        parent.expression !== current
    ) {
        return false;
    }
    const attribute = getParent(parent);
    return (
        attribute?.type === AST_NODE_TYPES.JSXAttribute &&
        attribute.name.type === AST_NODE_TYPES.JSXIdentifier &&
        attribute.name.name === "key"
    );
}

function getParent(node: TSESTree.Node): TSESTree.Node | undefined {
    return (node as TSESTree.Node & { parent?: TSESTree.Node }).parent;
}

function isFunctionNode(node: unknown): node is FunctionNode {
    return (
        isNode(node) &&
        (node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
            node.type === AST_NODE_TYPES.FunctionDeclaration ||
            node.type === AST_NODE_TYPES.FunctionExpression)
    );
}

function isNode(value: unknown): value is TSESTree.Node {
    return (
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        typeof (value as { type?: unknown }).type === "string"
    );
}

export type NoUnobservedReactReadRule = TSESLint.RuleModule<
    MessageIds,
    Options
>;
