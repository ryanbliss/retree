# Findings May 27, 2026

## Interpreting results

I looked at [retree-benchmark-latest.md](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/benchmarks/results/retree-benchmark-latest.md) and its JSON sibling from `May 27 17:16`.

Big picture: the scary numbers are not evenly distributed. Most “normal” direct-node work is still small. Since the app already avoids `treeChanged` in hot React paths, the most relevant pain clusters are initial proxy/setup, proxying newly assigned collection values, `useNode` listener overhead under fan-out, and `ReactiveNode.dependencies` fan-out/churn. The `treeChanged` results are still useful as a stress test for the proxy/reproxy model, but they are not the primary product risk if the React app is mostly using `useNode`.

**Likely Architecture Flaws**

-   **Deep reads dominate propagation cost, but this is mostly a `treeChanged` caution signal.**  
    `Root treeChanged` jumps from avg `0.11 ms` with `read none` to `5.70 ms` with `read deep`; P95 goes from `0.21 ms` to `28.10 ms`.  
    `Ancestor treeChanged fan-out` is worse: `read none` avg `0.23 ms`, `read deep` avg `35.59 ms`, P95 `213.06 ms`. That smells like callbacks are forcing broad/deep traversal or proxy access work during emission. Because the app does not lean on `treeChanged`, this should stay documented as a sharp edge rather than drive the first optimization pass.

-   **Ancestor treeChanged fan-out scales brutally with depth and width together.**  
    Very high depth + very high width cases hit avg `276 ms`, P95 `298 ms`, max `369 ms`. Width alone moves from avg `3.00 ms` at width Low to `43.92 ms` at width Very high. Depth moves from avg `1.77 ms` to `50.20 ms`. This looks like multiplicative propagation/listener work along ancestor paths.

-   **Listener/dependency fan-out is materially linear with subscriber count.**  
    `Listener fan-out nodeChanged`: listener count `5` avg `1.42 ms`; listener count `25` avg `6.45 ms`.  
    `Reactive dependency fan-out`: dependency fanout `5` avg `0.32 ms`; fanout `25` avg `4.74 ms`. That is expected mechanically, but it is a real architectural scaling boundary for React-like usage with many observers.

-   **Initial `Retree.root` / proxy setup is a serious render-time risk.**  
    Across scenarios, setup is usually dominated by `root-proxy`, often P95 `24-59 ms`, with maxes over `100-200 ms` in some scenarios. If React app “on render” behavior constructs/proxies fresh trees, this is very plausibly part of the jank.

-   **Proxying newly assigned collection objects is probably the same class of problem as initial root proxying.**  
    The benchmark's setup tables isolate `root-proxy`, but the same `buildProxy(...)` path runs when a property is assigned a fresh object, array, map, or set. If real app flows assign new `Set` instances with many object values, Retree may synchronously proxy or parent a whole collection during that single assignment. This is likely more relevant than the current mutation-type summary makes obvious.

-   **`runTransaction` does not flatten the cost enough for large transaction bodies.**  
    `10` mutations avg `1.78 ms`; `100` mutations avg `13.10 ms`, P95 `40.94 ms`. Transactions are helping shape emission behavior, but the internal mutation/proxy/change bookkeeping still scales with operation count.

**Low Hanging Fruit**

-   **Array and Map mutations are consistently slower than scalar/object/set in hot paths, but this may not be enough by itself.**  
    In `runTransaction`, `array-push` avg `16.25 ms`, `map-set` avg `15.83 ms`, while `set-add` is `2.86 ms`. Similar warnings appear across direct, root, dependency, and effect scenarios. There may be avoidable cloning, iteration, or child-parent bookkeeping in array/map paths, but this is probably secondary to broader proxy creation and dependency subscription costs.

-   **Direct `nodeChanged` itself is mostly fine unless width plus deep reads enter.**  
    Overall avg `0.376 ms`, median `0.112 ms`, P95 `0.411 ms`. But width Very high avg rises to `0.70 ms`, and deep read avg is `0.64 ms` vs `0.11 ms` for none. Optimize callback read/proxy materialization before overhauling direct node emission.

-   **Subscription churn looks healthy.**  
    Avg `0.018 ms`, median `0.005 ms`, P95 around `0.007 ms`. I would not spend time here unless app traces show pathological repeated subscribe/unsubscribe loops.

-   **`onChanged effect` baseline looks acceptable.**  
    Avg `0.392 ms`, P95 `0.356 ms`; width/deep-read effects still show up, but the effect mechanism itself does not look like the main offender.

-   **Setup measurement suggests a focused optimization target: lazy proxying.**  
    `raw-tree-construction` is usually much smaller than `root-proxy`. If Retree currently eagerly proxies/traverses broad side structures, lazily proxying children/maps/sets/arrays could probably pay off quickly.

My read after accounting for actual app usage: the fundamental concern is not `treeChanged` by itself. The first things to investigate are eager proxy creation, proxying newly assigned collections, `ReactiveNode.dependencies` subscription churn/fan-out, and the listener path used by `useNode`. `treeChanged` remains a known sharp edge, but it should be lower priority if the app already avoids it.

## Opportunities for architecture improvements

I dug through core. My read is: some of this is genuinely the cost of Retree’s proxy/reproxy model, but there are two architectural improvements that would likely move the needle for current app usage: lazy proxying and dependency subscription diffing. The `treeChanged`/deep-read case is more fundamental, but less urgent for the React app if it is already using `useNode` instead of `useTree`/`treeChanged` in hot paths.

**1. Eager Proxying: Improvable, High Leverage**

`Retree.root()` immediately calls `buildProxy()`:

[Retree.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/Retree.ts:91)

```ts
static root<T extends TreeNode = TreeNode>(object: T): T {
    return buildProxy<T>(object, this.nodeChangeEmitter);
}
```

The expensive part is here:

[proxy.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/internals/proxy.ts:432)

```ts
const proxy = new Proxy(object, proxyHandler) as TCustomProxy<T>;
if (object instanceof Map) {
    const entries = Array.from(object.entries());
    for (const [key, value] of entries) {
        if (value !== null && typeof value === "object") {
            const childProxy = isCustomProxy(value)
                ? reparentProxy(value, parentToSet)
                : buildProxy(value, emitter, parentToSet);
            Map.prototype.set.call(object, key, childProxy);
        }
    }
} else {
    Object.entries(object).forEach(([prop, value]) => {
        ...
        const cProxy = buildProxy(value, emitter, {
            proxyNode: proxy,
            propName: prop,
        });
        proxyHandler[proxiedChildrenKey][prop] = getBaseProxy(cProxy);
    });
}
```

That means `Retree.root()` recursively walks and proxies arrays, records, nested nodes, map values, etc. This directly explains the benchmark setup results where `root-proxy` dominates setup and where width hurts before any actual listener emission happens.

The same concern applies after initialization. The `set` trap calls `buildProxy(newValue, ...)` for any freshly assigned object:

[proxy.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/internals/proxy.ts:205)

```ts
set(target, prop, newValue, receiver) {
    ...
    if (newValue !== null && typeof newValue === "object") {
        ...
        valueToSet = isCustomProxy(newValue)
            ? reparentProxy(newValue, parentToSet)
            : buildProxy(newValue, emitter, parentToSet);
        proxyHandler[proxiedChildrenKey][prop] = valueToSet;
    }
    ...
}
```

So assigning a new broad `Set`, `Map`, array, or object is not just a cheap pointer swap. It can synchronously proxy and parent every reachable child. This is very likely the root cause behind expensive "new Set object" updates.

This is not fundamental to proxies. It is a current design choice.

A rough better shape:

```ts
function getOrCreateChildProxy(
    target: object,
    prop: string | symbol,
    value: unknown,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter,
    handler: ICustomProxyHandler<any>
): unknown {
    if (value === null) return value;
    if (typeof value !== "object") return value;

    const cached = handler[proxiedChildrenKey][prop];
    if (cached) return cached;

    const parentToSet: IProxyParent<any> = {
        proxyNode: baseProxy,
        propName: prop,
    };

    const proxied = isCustomProxy(value)
        ? reparentProxy(value, parentToSet)
        : buildProxy(value, emitter, parentToSet);

    const baseChildProxy = getBaseProxy(proxied);
    handler[proxiedChildrenKey][prop] = baseChildProxy;
    return baseChildProxy;
}
```

Then in the `get` trap, instead of eagerly proxying every child during `buildProxy()`:

```ts
const value = Reflect.get(target, prop, receiver);
return getOrCreateChildProxy(
    target,
    prop,
    value,
    baseProxy,
    emitter,
    proxyHandler
);
```

This would move cost from `Retree.root()` to “first access along the path.” That is probably a good trade for React render behavior, because most renders do not touch every side branch of a large state tree.

Map/Set need extra care: Map `get`, `values`, `entries`, iteration, and `forEach` would need lazy wrapping so values become proxied when observed. Set is trickier because values are also keys; replacing raw values with proxy values changes identity semantics unless Retree preserves raw-key lookup behavior. This does not make lazy collection proxying impossible, but it means Set support needs a deliberate wrapper strategy rather than a naive "proxy all values on first read" approach.

For the app's likely pain, a staged version may be best:

1. Lazy proxy plain object and array children first.
2. Keep Map/Set root objects proxied but delay proxying object values where identity semantics allow it.
3. Add targeted benchmarks for assigning fresh broad `Set` and `Map` instances, because the current mutation tables do not isolate "new collection object proxy cost" cleanly enough.

**2. treeChanged Ancestor Propagation: Partly Fundamental**

This is real, but lower priority for the React app if `treeChanged` is already avoided in hot paths.

Every node mutation eventually does:

[Retree.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/Retree.ts:561)

```ts
if (!Transactions.skipEmit) {
    scheduleNodeChangedListeners();
}

this.handleNotifyTreeChanged(unproxiedNode, proxyNode, proxyNode);
```

And `handleNotifyTreeChanged()` climbs parent-by-parent:

[Retree.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/Retree.ts:369)

```ts
const parent = this.getParentInternal(proxyNode);
...
checkedParentProxyNodes.push(parent.proxyNode);

this.handleNotifyTreeChanged(
    parent.rawNode,
    parent.proxyNode,
    proxyNodeThatChanged,
    topProxyNodeListenedTo,
    confirmedCallbacksToNotify,
    checkedParentProxyNodes
);
```

When it finds a tree listener, it reproxies each parent on the path:

[Retree.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/Retree.ts:427)

```ts
for (let pIndex = 0; pIndex < checkedParentProxyNodes.length; pIndex++) {
    const pNode = checkedParentProxyNodes[pIndex];
    const pReproxyNode = updateReproxyNode(getBaseProxy(pNode));
    ...
    confirmedCallbacksToNotify.get(pNode)?.forEach((c) => c(pReproxyNode));
}
```

This explains the brutal `Ancestor treeChanged fan-out` results. If a deep leaf changes and Retree wants every listened ancestor to receive a fresh identity, Retree must update identities along that path. That part is fundamental to the current “proxy plus reproxy identity” approach.

What is improvable:

```ts
if (this.treeChangedListeners.size > 0) {
    this.handleNotifyTreeChanged(unproxiedNode, proxyNode, proxyNode);
}
```

That avoids parent walking entirely for pure `nodeChanged` workloads. It will not fix root `treeChanged`, but it removes unnecessary bookkeeping from direct node listeners and therefore matters for `useNode`.

The bigger architectural alternative is to stop treating `treeChanged` as “deep invalidation with fresh identity along the whole path” and introduce narrower subscriptions:

```ts
Retree.onPath(root, ["children", id, "title"], callback);
Retree.select(node, selector, callback);
Retree.on(root, "treeChanged", callback, { identity: "root-only" });
```

That is not a small optimization. It changes the model from “ancestor path identity propagation” to “dependency/selector invalidation.” But that is the path out of the fundamental depth × width × fan-out cost.

**3. Deep Callback Reads: Mostly Fundamental, But Less Relevant Without treeChanged**

The benchmark’s `read deep` cases are expensive because the listener itself reads through a large proxied tree. Reproxy reads do this:

[reproxy.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/internals/reproxy.ts:84)

```ts
if (
    typeof prop === "string" &&
    prop !== "constructor" &&
    handler[proxiedChildrenKey][prop]
) {
    const childProxy = handler[proxiedChildrenKey][prop];
    if (typeof childProxy !== "function") {
        const reproxy = getReproxyNode(childProxy);
        return reproxy ?? childProxy;
    }
}
```

So deep traversal means many proxy traps plus many reproxy lookups. Some overhead is improvable, but reading a large tree in a listener is inherently O(nodes read). Retree cannot make “read the whole subtree” cheap without caching a derived result and invalidating it precisely.

Best architectural fix for the `treeChanged` version of this problem: selector/memo subscriptions rather than deep tree reads in listeners.

```ts
Retree.select(
    rowsNode,
    (rows) => rows.map((row) => row.total),
    (totals) => {
        setTotals(totals);
    }
);
```

This should accept any Retree-managed node, not just the root. In practice, the more useful API is probably:

```ts
const totals = useSelect(rowsNode, (rows) => rows.map((row) => row.total));
```

Core would own the subscription primitive, while React would wrap it with a hook:

```ts
const unsubscribe = Retree.select(
    node,
    selector,
    (nextSelectedValue) => {
        setSnapshot(nextSelectedValue);
    },
    {
        equals: Object.is,
    }
);
```

That would let Retree track or declare dependencies and avoid every render/listener walking the full object graph. `useSelect` would give React users a `useNode`-like ergonomics layer for derived values without requiring a custom `ReactiveNode` solely to bridge dependency updates into a component render.

Important nuance: this is different from existing `memo`, `fnMemo`, and `ReactiveNode.memo`.

-   `memo` / `fnMemo` cache derived values on a `ReactiveNode` instance. They reduce recomputation when that getter/method is read.
-   They do not, by themselves, create a Retree subscription or decide whether a React component should re-render.
-   `ReactiveNode.dependencies` does create subscription behavior, but at the node level: dependency changes reproxy/emit the dependent node.
-   A hypothetical `Retree.select` would be a subscription primitive: "rerun this selector for any Retree node when its declared/tracked inputs change, then emit only when the selected value changes."
-   A hypothetical `useSelect` would be the React hook wrapper over `Retree.select`, similar in spirit to `useNode`, but returning a selected value instead of a reproxy for the whole node.

So `Retree.select` / `useSelect` would not replace `memo`/`fnMemo`; they would sit closer to `useSyncExternalStore` selector semantics. They could use memoized getters internally, but their main value would be narrowing React re-renders without requiring a full `ReactiveNode` dependency edge.

**4. Reactive Dependencies: Improvable, High Leverage**

This part looks more fixable than fundamental.

On every reactive node change, Retree calls:

[Retree.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/Retree.ts:533)

```ts
if (isReactiveNode) {
    this.handleReactiveNode(proxyNode, unproxiedNode);
}
```

Then `handleReactiveNode()` recomputes dependencies and unsubscribes/resubscribes each one:

[Retree.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/Retree.ts:613)

```ts
const current = proxiedDependentNode.dependencies;
const previous = getReactiveDependencies(unproxiedDependentNode);
...
depPrevious?.unsubscribeListener?.();
const currentDependency =
    proxiedDependentNode.dependencies[depIndex];
...
unsubscribe = this.on(
    newDependencyNode,
    "nodeChanged",
    this.handleReactiveDependentNodeChanged.bind(this)
);
```

There are two red flags:

-   `dependencies` is evaluated multiple times in the same function.
-   every dependency gets unsubscribed and resubscribed even if the dependency node did not change.
-   many dependents on the same dependency may each register their own Retree listener even though the handler already fans out through `getReactiveDependents(...)`.

That is not fundamental. The dependency fan-out cost is fundamental-ish, but the resubscribe churn is not.

Rough fix shape:

```ts
const currentDependencies = proxiedDependentNode.dependencies;
const previousDependencies = getReactiveDependencies(unproxiedDependentNode);

for (let index = 0; index < currentDependencies.length; index++) {
    const currentDependency = currentDependencies[index];
    const previousDependency = previousDependencies?.[index];

    if (previousDependency?.node === currentDependency.node) {
        newActiveDependencies.push({
            ...previousDependency,
            comparisons: currentDependency.comparisons,
        });
        continue;
    }

    previousDependency?.unsubscribeListener?.();

    if (!currentDependency.node) {
        newActiveDependencies.push({
            node: currentDependency.node,
            comparisons: currentDependency.comparisons,
            unsubscribeListener: undefined,
        });
        continue;
    }

    const unsubscribeListener = this.on(
        currentDependency.node,
        "nodeChanged",
        this.handleReactiveDependentNodeChanged
    );

    newActiveDependencies.push({
        node: currentDependency.node,
        comparisons: currentDependency.comparisons,
        unsubscribeListener,
    });
}
```

This keeps the unavoidable part, “notify N dependents,” but removes avoidable subscription churn.

There is another likely improvement in the dependency hot path: `handleReactiveNode()` reads `proxiedDependentNode.dependencies` more than once per update. If the dependency getter does non-trivial work or creates arrays/comparisons, that cost repeats:

[Retree.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/Retree.ts:613)

```ts
const current = proxiedDependentNode.dependencies;
...
for (
    let depIndex = 0;
    depIndex < proxiedDependentNode.dependencies.length;
    depIndex++
) {
    ...
    const currentDependency =
        proxiedDependentNode.dependencies[depIndex];
}
```

The first fix should be to read it once:

```ts
const currentDependencies = proxiedDependentNode.dependencies;

for (let depIndex = 0; depIndex < currentDependencies.length; depIndex++) {
    const currentDependency = currentDependencies[depIndex];
    ...
}
```

That is much smaller than full dependency diffing, and it should be very safe.

The bigger dependency optimization is to share one Retree listener per dependency node. Reusing the same callback function is not enough, because Retree stores listeners in an array; pushing the same function 25 times still calls it 25 times. The win is registering one listener for the dependency node, then letting `handleReactiveDependentNodeChanged(...)` fan out to all reactive dependents once.

The current code shape can accidentally become expensive when many `ReactiveNode`s depend on the same node:

```ts
unsubscribe = this.on(
    newDependencyNode,
    "nodeChanged",
    this.handleReactiveDependentNodeChanged.bind(this)
);
```

Each registered listener calls:

```ts
const dependents = getReactiveDependents(_unproxy);

dependents.forEach((dependent) => {
    ...
});
```

If 25 dependent nodes all point at the same dependency node, the current shape can call the dependency handler 25 times, and each call can scan the same 25 dependents. That is the case where a shared listener can move the work closer to O(N) instead of O(N squared).

Rough fix shape:

```ts
interface IReactiveDependencySubscription {
    refCount: number;
    unsubscribe: () => void;
}

const reactiveDependencySubscriptions = new WeakMap<
    TreeNode,
    IReactiveDependencySubscription
>();

function subscribeReactiveDependency(node: TreeNode): () => void {
    const unproxiedNode = getUnproxiedNode(node);
    if (!unproxiedNode) {
        throw new Error(
            "subscribeReactiveDependency: dependency node must be proxied."
        );
    }

    const existing = reactiveDependencySubscriptions.get(unproxiedNode);
    if (existing) {
        existing.refCount++;
        return () => {
            existing.refCount--;
            if (existing.refCount === 0) {
                existing.unsubscribe();
                reactiveDependencySubscriptions.delete(unproxiedNode);
            }
        };
    }

    const unsubscribe = Retree.on(
        node,
        "nodeChanged",
        Retree.handleReactiveDependentNodeChanged
    );

    reactiveDependencySubscriptions.set(unproxiedNode, {
        refCount: 1,
        unsubscribe,
    });

    return () => {
        const current = reactiveDependencySubscriptions.get(unproxiedNode);
        if (!current) return;

        current.refCount--;
        if (current.refCount === 0) {
            current.unsubscribe();
            reactiveDependencySubscriptions.delete(unproxiedNode);
        }
    };
}
```

The exact implementation probably belongs inside Retree internals rather than as a public helper, and it should avoid rebinding `handleReactiveDependentNodeChanged` for every dependency. The important architectural point is one listener registration per dependency node, not one listener registration per dependent edge.

**5. Fan-Out: Fundamental With Small Optimizations**

Listener emit does this:

[Retree.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/Retree.ts:538)

```ts
const nodeChangedListnersToNotify =
    this.nodeChangedListeners.get(unproxiedNode) ?? [];

[...nodeChangedListnersToNotify].forEach((callback) => {
    callback(reproxyNode);
});
```

Calling 25 listeners costs more than calling 5. That is fundamental. The array copy is a small cost, but it is not the source of the benchmark’s large numbers. The bigger issue is “25 listeners that each deep-read,” not dispatch itself.

However, there are two different "many listeners" cases:

-   Many components using `useNode` on the same node could share a single Retree listener through a per-node React subscription hub. That may reduce Retree-level dispatch, but React still has to notify each component subscriber.
-   Many `ReactiveNode`s depending on the same node is more promising. A shared dependency listener can avoid registering duplicate Retree listeners that all scan the same dependent list.

For `useNode`, the most relevant listener overhead is likely not the array copy alone. The React adapter listens with:

[useNodeInternal.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-react/src/internals/useNodeInternal.ts:39)

```ts
useEffect(() => {
    const unsubscribe = Retree.on<T>(baseProxy, listenerType, (proxy) => {
        setNodeState({ node: proxy });
    });
    return () => {
        unsubscribe();
    };
}, [baseProxy, listenerType]);
```

That means every active `useNode(node)` is a real Retree listener. Fan-out is therefore expected when many components subscribe to the same node. The low-level emitter can be shaved a little, but the larger architectural escape hatch is to avoid many components subscribing to the exact same broad node when they could subscribe to narrower children or to a selected derived value.

My recommendation order:

1. Lazy proxy child creation in `buildProxy`.
2. Add targeted benchmarks for assigning fresh broad `Set`, `Map`, array, and object values.
3. Read `ReactiveNode.dependencies` once per update.
4. Share one Retree listener per dependency node for `ReactiveNode.dependencies`.
5. Diff `ReactiveNode.dependencies` instead of full unsubscribe/resubscribe.
6. Short-circuit `handleNotifyTreeChanged` when there are no tree listeners, because that benefits pure `useNode` workloads.
7. Consider a selector/path subscription API as a complement to `memo` / `fnMemo`, not a replacement.
8. Treat ancestor `treeChanged` identity propagation as a known fundamental cost of the current proxy/reproxy architecture, but deprioritize it if docs already caution against `treeChanged` and the React app is not using it heavily.
