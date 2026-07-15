import { performance } from "node:perf_hooks";
import { ReactiveNode, Retree, type IReactiveDependency } from "@retreejs/core";
import type {
    BenchmarkSetupMeasurement,
    BenchmarkSetupOperation,
} from "./types.js";

export interface BuildBenchmarkTreeOptions {
    depth: number;
    seed: number;
    width: number;
    setupMeasurements?: BenchmarkSetupMeasurement[];
}

export interface BuiltBenchmarkTree {
    nodesByDepth: BenchmarkNode[];
    root: BenchmarkNode;
    target: BenchmarkNode;
}

export interface SerializableBenchmarkNode {
    arrayChildren: SerializableBenchmarkLeaf[];
    id: string;
    mapChildren: Array<[string, SerializableBenchmarkLeaf]>;
    metadata: BenchmarkMetadataPayload;
    primary: SerializableBenchmarkNode | null;
    primitiveMapChildren: Array<[string, number]>;
    primitiveSetChildren: number[];
    recordChildren: Record<string, SerializableBenchmarkLeaf>;
    setChildren: SerializableBenchmarkLeaf[];
    value: number;
    wideChildren: SerializableBenchmarkNode[];
}

export interface SerializableBenchmarkLeaf {
    id: string;
    metadata: {
        active: boolean;
        counts: number[];
        score: number;
    };
    value: number;
}

interface BenchmarkMetadataPayload {
    flags: boolean[];
    label: string;
    stats: {
        score: number;
        version: number;
    };
    tags: string[];
}

const dependencyRefsByNode = new WeakMap<BenchmarkNode, BenchmarkNode[]>();
const changedEffectByNode = new WeakMap<
    BenchmarkNode,
    {
        handledValue?: number;
        writes: number;
    }
>();
const dependencyMirrorByNode = new WeakMap<BenchmarkNode, BenchmarkNode>();

export class BenchmarkLeafNode extends ReactiveNode {
    public id: string;
    public metadata: {
        active: boolean;
        counts: number[];
        score: number;
    };
    public value: number;

    constructor(id: string, value: number, metadataSeed: number) {
        super();
        this.id = id;
        this.value = value;
        this.metadata = {
            active: metadataSeed % 2 === 0,
            counts: [metadataSeed % 3, metadataSeed % 5, metadataSeed % 7],
            score: metadataSeed / 1000,
        };
    }

    get dependencies(): IReactiveDependency[] {
        return [];
    }
}

export class BenchmarkNode extends ReactiveNode {
    public arrayChildren: BenchmarkLeafNode[];
    public id: string;
    public mapChildren: Map<string, BenchmarkLeafNode>;
    public metadata: BenchmarkMetadataPayload;
    public primary: BenchmarkNode | null;
    public primitiveMapChildren: Map<string, number>;
    public primitiveSetChildren: Set<number>;
    public recordChildren: Record<string, BenchmarkLeafNode>;
    public setChildren: Set<BenchmarkLeafNode>;
    public value: number;
    public wideChildren: BenchmarkNode[];

    constructor(options: {
        arrayChildren: BenchmarkLeafNode[];
        id: string;
        mapChildren: Map<string, BenchmarkLeafNode>;
        metadata: BenchmarkMetadataPayload;
        primary: BenchmarkNode | null;
        primitiveMapChildren: Map<string, number>;
        primitiveSetChildren: Set<number>;
        recordChildren: Record<string, BenchmarkLeafNode>;
        setChildren: Set<BenchmarkLeafNode>;
        value: number;
        wideChildren: BenchmarkNode[];
    }) {
        super();
        this.arrayChildren = options.arrayChildren;
        this.id = options.id;
        this.mapChildren = options.mapChildren;
        this.metadata = options.metadata;
        this.primary = options.primary;
        this.primitiveMapChildren = options.primitiveMapChildren;
        this.primitiveSetChildren = options.primitiveSetChildren;
        this.recordChildren = options.recordChildren;
        this.setChildren = options.setChildren;
        this.value = options.value;
        this.wideChildren = options.wideChildren;
    }

    get dependencies(): IReactiveDependency[] {
        const dependencyRefs = dependencyRefsByNode.get(this);
        if (dependencyRefs === undefined) {
            return [];
        }
        return dependencyRefs.map((node) => this.dependency(node));
    }

    protected onChanged(): void {
        const dependencyMirror = dependencyMirrorByNode.get(this);
        if (dependencyMirror !== undefined) {
            this.value = dependencyMirror.value;
            this.metadata.stats.version =
                dependencyMirror.metadata.stats.version;
        }

        const effectConfig = changedEffectByNode.get(this);
        if (effectConfig === undefined) {
            return;
        }
        if (effectConfig.handledValue === this.value) {
            return;
        }

        effectConfig.handledValue = this.value;
        for (
            let writeIndex = 0;
            writeIndex < effectConfig.writes;
            writeIndex++
        ) {
            this.metadata.stats.version =
                this.metadata.stats.version + writeIndex + 1;
            const leaf =
                this.arrayChildren[writeIndex % this.arrayChildren.length];
            if (leaf !== undefined) {
                leaf.value = leaf.value + 1;
            }
        }
    }
}

export function setBenchmarkDependencies(
    node: BenchmarkNode,
    dependencies: BenchmarkNode[]
) {
    dependencyRefsByNode.set(node, [...dependencies]);
}

export function configureBenchmarkChangedEffect(
    node: BenchmarkNode,
    writes: number
) {
    if (!Number.isInteger(writes)) {
        throw new Error(
            `Benchmark changed effect writes must be an integer. Received ${writes}.`
        );
    }
    if (writes < 1) {
        throw new Error(
            `Benchmark changed effect writes must be at least one. Received ${writes}.`
        );
    }
    changedEffectByNode.set(node, {
        writes,
    });
}

export function configureBenchmarkDependencyMirror(
    node: BenchmarkNode,
    dependency: BenchmarkNode
) {
    dependencyMirrorByNode.set(node, dependency);
}

export function createBenchmarkDependentNodes(options: {
    count: number;
    seed: number;
    setupMeasurements?: BenchmarkSetupMeasurement[];
}) {
    if (!Number.isInteger(options.count)) {
        throw new Error(
            `Benchmark dependent node count must be an integer. Received ${options.count}.`
        );
    }
    if (options.count < 0) {
        throw new Error(
            `Benchmark dependent node count must be zero or greater. Received ${options.count}.`
        );
    }

    const rng = new SeededRandom(options.seed);
    const dependents: BenchmarkNode[] = [];
    for (let index = 0; index < options.count; index++) {
        const rawNode = measureSetupOperation(
            options.setupMeasurements,
            "raw-dependent-node-construction",
            () => createRawSideNode(0, index, rng)
        );
        const root = measureSetupOperation(
            options.setupMeasurements,
            "dependent-node-root-proxy",
            () => Retree.root(rawNode)
        );
        dependents.push(root);
    }
    return dependents;
}

export function createBenchmarkTree(
    options: BuildBenchmarkTreeOptions
): BuiltBenchmarkTree {
    if (!Number.isInteger(options.depth)) {
        throw new Error(
            `Benchmark tree depth must be an integer. Received ${options.depth}.`
        );
    }
    if (options.depth < 0) {
        throw new Error(
            `Benchmark tree depth must be zero or greater. Received ${options.depth}.`
        );
    }
    if (!Number.isInteger(options.seed)) {
        throw new Error(
            `Benchmark tree seed must be an integer. Received ${options.seed}.`
        );
    }
    if (!Number.isInteger(options.width)) {
        throw new Error(
            `Benchmark tree width must be an integer. Received ${options.width}.`
        );
    }
    if (options.width < 0) {
        throw new Error(
            `Benchmark tree width must be zero or greater. Received ${options.width}.`
        );
    }

    const rng = new SeededRandom(options.seed);
    const rawRoot = measureSetupOperation(
        options.setupMeasurements,
        "raw-tree-construction",
        () => createRawNode(0, options.depth, options.width, rng)
    );
    const root = measureSetupOperation(
        options.setupMeasurements,
        "root-proxy",
        () => Retree.root(rawRoot)
    );
    const nodesByDepth = measureSetupOperation(
        options.setupMeasurements,
        "primary-path-collection",
        () => collectPrimaryPath(root)
    );
    const target = nodesByDepth[options.depth];

    if (target === undefined) {
        throw new Error(
            `Benchmark tree target missing at depth ${options.depth}. Built ${nodesByDepth.length} nodes.`
        );
    }

    return {
        nodesByDepth,
        root,
        target,
    };
}

function measureSetupOperation<T>(
    setupMeasurements: BenchmarkSetupMeasurement[] | undefined,
    operation: BenchmarkSetupOperation,
    run: () => T
): T {
    const startedAt = performance.now();
    const value = run();
    setupMeasurements?.push({
        durationMs: performance.now() - startedAt,
        operation,
    });
    return value;
}

export function serializeBenchmarkNode(
    node: BenchmarkNode
): SerializableBenchmarkNode {
    return {
        arrayChildren: node.arrayChildren.map(serializeBenchmarkLeaf),
        id: node.id,
        mapChildren: [...node.mapChildren.entries()].map(([key, value]) => [
            key,
            serializeBenchmarkLeaf(value),
        ]),
        metadata: {
            flags: [...node.metadata.flags],
            label: node.metadata.label,
            stats: {
                score: node.metadata.stats.score,
                version: node.metadata.stats.version,
            },
            tags: [...node.metadata.tags],
        },
        primary:
            node.primary === null ? null : serializeBenchmarkNode(node.primary),
        primitiveMapChildren: [...node.primitiveMapChildren.entries()],
        primitiveSetChildren: [...node.primitiveSetChildren.values()],
        recordChildren: Object.fromEntries(
            Object.entries(node.recordChildren).map(([key, value]) => [
                key,
                serializeBenchmarkLeaf(value),
            ])
        ),
        setChildren: [...node.setChildren.values()].map(serializeBenchmarkLeaf),
        value: node.value,
        wideChildren: node.wideChildren.map(serializeBenchmarkNode),
    };
}

function serializeBenchmarkLeaf(
    node: BenchmarkLeafNode
): SerializableBenchmarkLeaf {
    return {
        id: node.id,
        metadata: {
            active: node.metadata.active,
            counts: [...node.metadata.counts],
            score: node.metadata.score,
        },
        value: node.value,
    };
}

function createRawNode(
    currentDepth: number,
    maxDepth: number,
    width: number,
    rng: SeededRandom
): BenchmarkNode {
    const id = `node-${currentDepth}-${rng.nextInt(1_000_000)}`;
    const primary =
        currentDepth >= maxDepth
            ? null
            : createRawNode(currentDepth + 1, maxDepth, width, rng);
    const wideChildren = createWideChildren(currentDepth, width, rng);

    return createRawBenchmarkNode({
        currentDepth,
        id,
        primary,
        rng,
        wideChildren,
    });
}

function createRawSideNode(
    currentDepth: number,
    childIndex: number,
    rng: SeededRandom
) {
    return createRawBenchmarkNode({
        currentDepth,
        id: `wide-${currentDepth}-${childIndex}-${rng.nextInt(1_000_000)}`,
        primary: null,
        rng,
        wideChildren: [],
    });
}

function createRawBenchmarkNode(options: {
    currentDepth: number;
    id: string;
    primary: BenchmarkNode | null;
    rng: SeededRandom;
    wideChildren: BenchmarkNode[];
}): BenchmarkNode {
    const value = options.rng.nextInt(10_000);
    const arrayChildren = createLeaves(
        `array-${options.currentDepth}`,
        options.rng
    );
    const recordChildren = Object.fromEntries(
        createLeaves(`record-${options.currentDepth}`, options.rng).map(
            (leaf, index) => [`record-${index}`, leaf]
        )
    );
    const mapChildren = new Map<string, BenchmarkLeafNode>(
        createLeaves(`map-${options.currentDepth}`, options.rng).map(
            (leaf, index) => [`map-${index}`, leaf]
        )
    );
    const primitiveMapChildren = new Map<string, number>(
        createPrimitiveValues(options.rng).map((value, index) => [
            `primitive-map-${index}`,
            value,
        ])
    );
    const primitiveSetChildren = new Set<number>(
        createPrimitiveValues(options.rng)
    );
    const setChildren = new Set<BenchmarkLeafNode>(
        createLeaves(`set-${options.currentDepth}`, options.rng)
    );

    return new BenchmarkNode({
        arrayChildren,
        id: options.id,
        mapChildren,
        metadata: {
            flags: [
                options.rng.nextBoolean(),
                options.rng.nextBoolean(),
                options.rng.nextBoolean(),
            ],
            label: `depth-${options.currentDepth}`,
            stats: {
                score: options.rng.nextInt(50_000) / 100,
                version: options.rng.nextInt(1_000),
            },
            tags: [
                `tier-${options.rng.nextInt(9)}`,
                `shape-${options.rng.nextInt(9)}`,
                `seed-${options.rng.nextInt(9)}`,
            ],
        },
        primary: options.primary,
        primitiveMapChildren,
        primitiveSetChildren,
        recordChildren,
        setChildren,
        value,
        wideChildren: options.wideChildren,
    });
}

function createWideChildren(
    currentDepth: number,
    width: number,
    rng: SeededRandom
) {
    const children: BenchmarkNode[] = [];
    for (let index = 0; index < width; index++) {
        children.push(createRawSideNode(currentDepth, index, rng));
    }
    return children;
}

function createLeaves(prefix: string, rng: SeededRandom) {
    const leaves: BenchmarkLeafNode[] = [];
    for (let index = 0; index < 3; index++) {
        leaves.push(
            new BenchmarkLeafNode(
                `${prefix}-leaf-${index}-${rng.nextInt(1_000_000)}`,
                rng.nextInt(10_000),
                rng.nextInt(10_000)
            )
        );
    }
    return leaves;
}

function createPrimitiveValues(rng: SeededRandom) {
    const values: number[] = [];
    for (let index = 0; index < 3; index++) {
        values.push(rng.nextInt(10_000));
    }
    return values;
}

export function createBenchmarkLeaf(
    prefix: string,
    seed: number
): BenchmarkLeafNode {
    const rng = new SeededRandom(seed);
    return new BenchmarkLeafNode(
        `${prefix}-leaf-${rng.nextInt(1_000_000)}`,
        rng.nextInt(10_000),
        rng.nextInt(10_000)
    );
}

function collectPrimaryPath(root: BenchmarkNode) {
    const nodes: BenchmarkNode[] = [];
    let current: BenchmarkNode | null = root;
    while (current !== null) {
        nodes.push(current);
        current = current.primary;
    }
    return nodes;
}

class SeededRandom {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0;
    }

    nextBoolean() {
        return this.nextInt(2) === 1;
    }

    nextInt(maxExclusive: number) {
        if (!Number.isInteger(maxExclusive)) {
            throw new Error(
                `SeededRandom.nextInt maxExclusive must be an integer. Received ${maxExclusive}.`
            );
        }
        if (maxExclusive <= 0) {
            throw new Error(
                `SeededRandom.nextInt maxExclusive must be greater than zero. Received ${maxExclusive}.`
            );
        }
        this.state = (1664525 * this.state + 1013904223) >>> 0;
        return this.state % maxExclusive;
    }
}
