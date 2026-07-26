# Spec: ESLint rule for unobserved Retree reads in React

Status: **draft — Phase A feasibility implementation in progress** (2026-07-25).
The initial package, typed-lint baseline, and proof-based local hook/path
analysis now live in `packages/retree-eslint-plugin`; Phase -1/0 runtime work,
factory-context tracing, and Phase B Retree semantic summaries remain deferred.

Implementation status is explicit throughout this document: **Phase A** means
the current package implements and tests the behavior; **deferred** describes
the proposed model only and must not be read as shipped behavior.

Proposed package: `@retreejs/eslint-plugin`

Proposed rule: `@retreejs/no-unobserved-react-read`

Context: [`useNode`](../packages/retree-react/src/useNode.ts) observes only the
node's own `nodeChanged` stream, while [`useTree`](../packages/retree-react/src/useTree.ts)
observes the subtree and [`useSelect`](../packages/retree-react/src/useSelect.ts)
can discover or declare narrower dependencies. `ReactiveNode.dependencies`
and `@select` can deliberately forward descendant changes to an owning node.

## 1. Decision

Build a **type-aware, proof-based** rule. In its default configuration it
reports only when it can prove all of the following:

1. a value came from a Retree node known to this rule;
2. code reads that value during the render phase of a component or custom
   hook;
3. the read requires a node's own changes to invalidate the render; and
4. no active Retree observation covers that node/change path.

The rule is intentionally not a theorem prover for arbitrary JavaScript. An
uncertain case is skipped, not guessed. The first public version should favor
very few false positives over finding every misuse.

There is **no existing React runtime backstop** for this bug. The dev-only
`warnOnUnsubscribedDescendantReads` check currently runs only through
`Retree.select(node, ...)`; React's node-form `useSelect` has a separate
untracked `getNodeSelection` path, and `useNode` does no render-read tracking.
Worse, the existing core warning currently false-positives when
`ReactiveNode.dependencies` legitimately forwards a descendant change. The
Phase -1 prerequisite in section 11 fixes and regression-tests that independent
runtime bug before any React warning reuses its logic. Even after that work,
runtime warnings do not cover ordinary `useNode` misuse and cannot replace the
proposed rule.

The rule requires TypeScript parser services. It must fail configuration with
a clear message when typed linting is unavailable; it must not silently run a
weaker algorithm. This follows typescript-eslint's recommendation not to make a
rule change behavior based only on whether type information happens to exist.
The repository currently uses `@typescript-eslint/parser` without `project` or
`projectService`, so establishing a typed-lint command and baseline is explicit
prerequisite work, not something the prototype may assume already exists.

## 2. The bug being detected

`useNode(node)` makes direct fields of `node` reactive for that component. It
does not make every reachable descendant reactive:

```tsx
function ProjectName({ project }: { project: Project }) {
    const state = useNode(project);
    return <span>{state.owner.name}</span>;
    //                         ^^^^ report: owner is not observed here
}
```

Changing `project.owner` re-renders because `owner` is owned by `project`.
Changing `project.owner.name` does not: `name` is owned by `owner`, whose
`nodeChanged` stream this component did not observe.

This is valid:

```tsx
function ProjectName({ project }: { project: Project }) {
    const state = useNode(project);
    const owner = useNode(state.owner);
    return <span>{owner.name}</span>;
}
```

So are a tracked selector and a deliberate subtree subscription:

```tsx
const name = useSelect(() => project.owner.name);
const projectTree = useTree(project);
```

The important unit is an **ownership boundary**, not a number of dots. Reading
`state.title` is covered by `useNode(state)`. Reading `state.owner.name`
crosses into the `owner` node before reading `name`.

## 3. Observation model

### 3.1 Coverage kinds

The analysis uses three coverage kinds for a known node identity:

| Coverage | Meaning                                                                     |
| -------- | --------------------------------------------------------------------------- |
| `none`   | The value is known to be managed, but this render is not invalidated by it. |
| `own`    | The node's `nodeChanged` stream is observed.                                |
| `tree`   | The node's `treeChanged` stream is observed; every descendant is covered.   |

Known APIs create coverage as follows:

| Expression                                                      | Coverage                                               | Status           |
| --------------------------------------------------------------- | ------------------------------------------------------ | ---------------- |
| `Retree.root(value)` / `useRoot(factory)`                       | known managed root, `none`                             | Phase A          |
| default `useRootContext<T>()`                                   | container only; members are `unknown` by default       | deferred         |
| factory-produced context `useRootContext()`                     | candidate container; traced managed members get `none` | deferred         |
| value typed as `ReactiveNode` with the opt-in heuristic enabled | heuristic candidate outside the proof coverage graph   | deferred Phase B |
| `useNode(node)`                                                 | `own` for `node`                                       | Phase A          |
| `useTree(node)`                                                 | `tree` for `node`                                      | Phase A          |
| first tuple item from `useRaw(node)`                            | raw provenance with `own` invalidation                 | Phase A          |
| first tuple item from tree-mode `useRaw(node)`                  | raw provenance with `tree` invalidation                | Phase A          |
| `toManaged(directRawChild)` from that `useRaw` tuple            | guaranteed managed node, `none`                        | Phase A          |
| `useSelect(() => expression)`                                   | tracked reads inside the selector are covered          | deferred Phase B |
| `useSelect(node, selector)`                                     | `own` for `node`, plus returned dependency nodes       | deferred Phase B |
| node-form `useSelect` with `treeChanged`                        | `tree` for `node`                                      | deferred Phase B |

Import resolution is by symbol and module, not local spelling, so aliased and
namespace imports work. A function merely named `useNode` is not treated as
Retree.

`Retree.root(...)` is a known managed origin. Values derived from known hook
results are known origins too. The `toManaged` function paired with a known
`useRaw` result guarantees materialization only for a direct raw child of that
hook's subscribed node. That direct-child result is a managed origin.

A deeper `toManaged(raw.child.grandchild)` call retains `T | undefined` and is
not a guaranteed origin: it resolves only if that deeper value was previously
materialized. A real runtime presence guard can establish that a returned
value exists and is managed, but a TypeScript non-null assertion does not prove
runtime success and must not make the rule accept or recommend the conversion.

A type assignable to the `ReactiveNode` export from `@retreejs/core` does
**not** prove a managed origin. `new Foo()` may never have passed through
`Retree.root`, and calling `useNode` on that unproxied instance throws. Such a
value is therefore `unknown` by default. A possible
`checkReactiveNodeValues` heuristic is deferred to Phase B and is not present
in the Phase A option schema or implementation.

Context hooks return a **container**, not a Retree node or an observation. The
default `useRootContext<T>()` implementation returns a caller-asserted `T` and
has no static connection to the provider's factory. Its members therefore stay
`unknown` unless their provenance is proved independently; a
`ReactiveNode`-typed member is still unknown unless the opt-in heuristic is
enabled. This default form is not a Phase A tracing target.

Hooks returned by `createRetreeContext<T>()` are recognized without
`additionalHooks`. For that paired factory form only, a container member may
become a known root when the checker can follow source-visible type/factory
declarations to `Retree.root`. This is bounded TypeScript declaration
traversal, not a project call-graph scan: each followed alias, return helper,
and member declaration counts against the same four-edge and 32-symbol budgets
in section 9.1. Anything unresolved becomes `unknown`. Other container members
remain `unknown`; the context API does not enforce that every member is
reactive.

A component prop of an ordinary plain-object type is not assumed to be
Retree-managed: `TreeNode<T>` is intentionally just `T` today. This bounds
completeness while avoiding diagnostics on unrelated object code.

### 3.2 Full-chain coverage

Every mutable owner on the path to a rendered leaf must be covered. For
example:

```tsx
const state = useNode(root);
const grandchild = useNode(state.child.grandchild);
return <span>{grandchild.name}</span>;
```

The final node is observed, but `child` is not. If `child.grandchild` is
replaced, neither `root.nodeChanged` nor the old grandchild subscription tells
the hook to switch nodes. The rule reports the unobserved read of
`child.grandchild`.

Valid alternatives include observing `child`, using `useTree(state.child)`, or
using the tracked form of `useSelect`, which can change its source set when a
path moves.

### 3.3 Node references versus node contents

Passing a node reference is not a content read. These are valid and should not
be reported:

```tsx
const list = useNode(project.tasks);

return list.map((task) => <TaskRow key={task.id} task={task} />);
//                                         ^^^^^ transfer is valid
//                            ^^^^^^^ exempt in v1: keys conventionally use stable IDs
```

The list observes add/remove/reorder operations. A child component can call
`useNode(task)` for its own fields. Strictly, a mutable `task.id` can make the
rendered key stale. In practice keys conventionally use immutable identity and
Retree's own examples use this pattern, while the type system often cannot
prove runtime immutability. V1 therefore exempts reads used only as a JSX
`key`. `checkJsxKeys: true` enables the stricter behavior; rendering the same
`task.id` as content is checked regardless.

The rule treats these uses as reference transfers rather than content reads:

-   passing a known node as a JSX prop or ordinary function argument;
-   returning it from a component-local helper or custom hook;
-   storing it in an object/array without spreading it;
-   passing it as the terminal argument to `useNode`, `useTree`, `useRaw`, or a
    configured equivalent;
-   passing raw provenance as the terminal argument to the matching
    `toManaged` returned by the same `useRaw` call.

The final bullet exempts the argument as a whole-value transfer; it does not
erase intermediate ownership boundaries. `toManaged(raw.owner)` is a guaranteed
direct-child conversion, while reaching `raw.owner.team` still requires
coverage of `owner` before the deeper reference can safely determine a
subscription.

This is deliberately escape-analysis-lite. The callee is not assumed to read
the node synchronously. Known whole-value consumers in section 5.4 are handled
separately.

### 3.4 Render phase

The rule checks code that executes while a component/custom hook renders:

-   the function body;
-   immediately invoked functions;
-   callbacks synchronously invoked by known collection operations such as
    `map`, `filter`, `find`, `reduce`, iteration, and JSX construction;
-   `useMemo` initializers, because they compute render output.

It does not report reads that occur only in deferred callbacks such as event
handlers, `useEffect`, `useLayoutEffect`, or `useCallback` bodies. Retree
proxies are live, so an event handler can read the current value without
needing that read to invalidate render. Other rules may still object to effect
semantics or writes during render.

Hook dependency arrays are different: their expressions execute during render
and declare when React should refresh a deferred callback or memo. They are
checked. This reports the stale-dependency case explicitly:

```tsx
useEffect(() => send(state.owner.name), [state.owner.name]);
//                                              ^^^^ report

useEffect(() => send(state.owner.name), []);
// deferred body only; intentionally once, no report from this rule
```

The same policy applies to dependency arrays for `useLayoutEffect`,
`useCallback`, and `useMemo`. The `useMemo` initializer is also checked because
it computes a render-time value.

This composes with `react-hooks/exhaustive-deps`: when that rule requires a
render-relevant member chain such as `[state.owner.name]`, this rule checks
whether Retree observation can actually invalidate that chain. One rule finds
the missing React dependency; the other finds the missing Retree observation.

If a value is read before a deferred callback is created, it is still a render
read and is checked:

```tsx
const label = state.child.label; // report
return <button onClick={() => alert(label)}>Show</button>;
```

## 4. Provenance and local data flow

The implementation performs a bounded per-function provenance pass. Current
and proposed coverage are separated below:

-   **Phase A:** simple assignments and aliases;
-   **Phase A:** object/array destructuring supported by the local binder;
-   **Phase A:** optional chains and statically known computed keys;
-   **Phase A:** array indexing, `for...of`, and synchronous array callback
    parameters;
-   **deferred:** `Map.get`, `values`, `entries`, and `forEach` result
    provenance;
-   **deferred:** `Set` iteration and callbacks;
-   **deferred:** returns from same-file custom-hook wrappers.

Examples that must be equivalent:

```tsx
const state = useNode(project);
state.owner.name;

const owner = state.owner;
owner.name;

const { owner } = state;
const { name } = owner;
```

Assignments through a mutable alias, computed keys that cannot be resolved,
`any`, unresolved overloads, and calls whose return provenance cannot be
proved turn that value into `unknown`. `unknown` provenance suppresses a
diagnostic. It must never be treated as proof that code is safe or unsafe.

The pass does not do whole-program points-to analysis. Cross-module custom
hooks are recognized only through the explicit `additionalHooks` option in
section 8.

## 5. Reads that require observation

### 5.1 Ordinary fields

A primitive or leaf field read requires `own` coverage of its owner. Obtaining
an object-valued child reference requires only coverage of the owner; reading
inside that child requires coverage of the child.

Only one diagnostic is emitted for one maximal expression. The report points
to the first field whose owner is not covered and names the node path that
needs observation.

Raw provenance remains distinct from managed-node provenance. In
`const [raw, toManaged] = useRaw(node)`, `raw.owner` is a raw object and cannot
be passed directly to `useNode`. A missing descendant invalidation receives the
raw-specific diagnostic in section 7. Converting and observing with
`toManaged` is a guaranteed fix only when the missing owner is a direct raw
child of the subscribed node, and only with the converter from that same tuple:

```tsx
const [raw, toManaged] = useRaw(project);
const owner = useNode(toManaged(raw.owner)!); // verified managed origin + own coverage
return <span>{owner.name}</span>; // valid
```

Aliasing the paired converter is supported. Passing the raw value to some
other function named `toManaged` or mixing converters from two `useRaw` calls
degrades to `unknown` rather than guessing.

For a deeper path, a non-null assertion is not a sound repair:

```tsx
const [raw, toManaged] = useRaw(project);
const team = useNode(toManaged(raw.owner.team)!); // report: owner is unobserved;
// toManaged may return undefined, and useNode(undefined) throws
```

The diagnostic instead recommends restructuring so the missing owner is a
direct child of the `useRaw` node, selecting from the managed tree, or choosing
tree-mode `useRaw`. If application code handles a deeper miss at runtime, the
defined branch may safely establish managed provenance:

```tsx
const maybeTeam = toManaged(raw.owner.team);
if (maybeTeam === undefined) {
    return null;
}
return <TeamView team={maybeTeam} />; // the guard proves this transfer is managed
```

That last pattern still does not solve an unobserved intermediate replacement;
normal full-chain coverage analysis applies independently. Any hook that
observes the converted node must also retain a stable, unconditional hook call
structure; the example uses a child boundary rather than conditionally calling
`useNode` after the guard.

### 5.2 Accessors and methods (deferred — Phase B)

A direct member is not necessarily direct state:

```tsx
class Project extends ReactiveNode {
    tasks: Task[] = [];

    get doneCount() {
        return this.tasks.filter((task) => task.done).length;
    }
}

const state = useNode(project);
return <span>{state.doneCount}</span>; // report
```

The type checker resolves source-visible getters and render-time method calls.
Their summaries contain the Retree paths read from `this` and any same-class
pure helper they call. A getter/method is covered only when every relevant
path it reads is covered by the receiver's own changes, declared dependency
forwarding, or `@select`.

Rules for common Retree decorators:

-   `@select` makes the decorated getter's **returned selection** an observed
    direct field of its owner. Reading `state.doneCount` is valid.
-   Traversing an object returned by `@select` is not automatically subtree-safe.
    `state.selectedTask.title` still needs coverage for `selectedTask`; an
    unchanged selected node identity does not imply its fields are observed.
-   `@memo` and `@fnMemo` cache or invalidate computation but do not by themselves
    emit a React-relevant owner change. Their bodies are analyzed like ordinary
    getters/methods unless `dependencies` also provides the needed bridge.
-   `@ignore` ends Retree provenance. The value is intentionally outside Retree
    reactivity, so this rule does not claim that another Retree hook would fix it.
-   `@link` preserves node provenance but does not imply subtree coverage.

If an accessor/method body or decorator cannot be resolved, that member is
`unknown` and is skipped. The rule must not assume an external declaration is
plain or reactive.

### 5.3 Collection and callback reads

The rule understands standard collection ownership:

```tsx
const tasks = useNode(project.tasks);

tasks.length; // valid: length belongs to the observed array
tasks.map((task) => <TaskRow task={task} />); // valid transfer
tasks.map((task) => <span>{task.title}</span>); // report title
```

Calling `map` on an unobserved descendant array is itself a whole-array read,
because additions/removals/reorders must invalidate the render:

```tsx
const project = useNode(root);
return project.tasks.map((task) => <TaskRow task={task} />);
//             ^^^^^ report: tasks is not observed
```

Phase A applies equivalent rules to object/array spread and array `for...of`.
Map/Set iteration and collection-size modeling are deferred.

### 5.4 Known whole-value consumers

The model includes operations that synchronously inspect a whole value, with
the shipped boundary shown explicitly:

-   **Phase A:** object/array spread expressions, array `for...of`, and JSX
    spread attributes;
-   **Phase A:** object destructuring of statically known properties;
-   **deferred:** object/array rest destructuring;
-   **deferred:** `Object.keys`, `Object.values`, `Object.entries`;
-   **deferred:** `JSON.stringify` and `structuredClone`;
-   **deferred:** Map/Set iteration APIs.

Passing a node to an unknown function remains a transfer. Expanding the
whole-value allowlist/denylist is a semver-minor rule improvement only when it
adds no diagnostic for previously documented-valid code; otherwise it waits
for a major version or a new strict rule.

### 5.5 Reads versus writes

Write-only assignment targets are not reported by this rule. Compound
assignments, increments, and calls that return a render value include a read
and are analyzed. React purity and Retree raw-write mistakes belong in separate
rules.

## 6. `dependencies`, `@select`, and selector semantics (deferred — Phase B)

Until these summaries exist, Phase A degrades member provenance to `unknown`
for a type assignable to the canonical `ReactiveNode` export from
`@retreejs/core`, and for source members with decorators. It does not infer
Retree semantics from a property named `dependencies`; ordinary application
types with such a field remain analyzable.

### 6.1 `ReactiveNode.dependencies`

For a source-visible `ReactiveNode`, the rule builds a memoized forwarding
summary from a `dependencies` getter or class field.

```ts
class Project extends ReactiveNode {
    owner = new Owner();

    get dependencies() {
        return [this.owner];
    }
}
```

`this.owner` means any `owner.nodeChanged` event can emit `project.nodeChanged`.
Therefore `useNode(project)` covers direct fields of `project.owner`, but not
arbitrary grandchildren of `owner`.

Comparison dependencies are narrower:

```ts
get dependencies() {
    return [this.dependency(this.owner, [this.owner.name])];
}
```

This proves that `useNode(project)` covers `project.owner.name`; it does not
prove coverage for `project.owner.avatarUrl`.

The summary supports array literals, spreads of statically known arrays,
conditionals, and early returns only when a dependency is present on every
reachable return path. Coverage is the intersection of control-flow paths,
not the union. A dynamic call, unresolved property, mutation-built array, or
external declaration makes the affected portion `unknown`.

Runtime-nullable node slots are also `unknown` in V1 even when the outer array
shape is syntactically fixed:

```ts
get dependencies() {
    return [
        this.dependency(this.selectedProject ?? null, [this.projectId]),
    ];
}
```

Retree correctly refreshes this slot as its runtime node appears/disappears,
but a syntax-only branch intersection does not prove when coverage exists.
Nullish coalescing, optional chaining in the node expression, and other
value-conditional dependency nodes therefore suppress a diagnostic unless a
later implementation adds a sound value-sensitive analysis.

Primitive comparison slots without a subscribed managed-node slot do not
create coverage. They can be compared when another subscribed change causes
reevaluation, but they cannot cause reevaluation themselves.

Forwarding may compose through multiple `ReactiveNode` classes. Analysis stops
at four forwarding edges or the first cycle; reaching either limit produces
`unknown`, not a diagnostic.

### 6.2 `@select`

Decorator identity is resolved to the `select` export from `@retreejs/core`,
including aliases.

-   Bare `@select` / `@select()` uses Retree's tracked getter semantics and
    proves the decorated getter's output is forwarded to its owner.
-   `@select(selector)` uses the explicit selector's returned nodes/comparisons,
    matching `normalizeSelectDependencies` rather than pretending it is tracked.
-   `@select(options)` is the tracked form with selection equality options.
-   Unknown decorator factories or legacy decorators are not inferred by name.

Again, the guarantee applies to the getter selection, not every field reachable
through an object-valued result.

### 6.3 `useSelect`

Tracked form is a safe dynamic boundary:

```tsx
const name = useSelect(() => project.owner.name); // valid
```

Node form follows its actual runtime contract. The root uses the requested
listener type, and Retree-managed nodes present as top-level items in the
returned selection become `nodeChanged` dependencies:

```tsx
const name = useSelect(project, (state) => state.owner.name);
// report: owner was read but is not a returned dependency

const [name] = useSelect(project, (state) => [state.owner.name, state.owner]); // valid: owner is a returned dependency

const nameFromTree = useSelect(project, (state) => state.owner.name, {
    listenerType: "treeChanged",
}); // valid
```

The analysis handles array-literal returns and straightforward aliases. A
dynamic returned selection is `unknown` and produces no static diagnostic.
There is currently no React warning for that case; the Phase 0 experiment in
section 11 proposes adding one for node-form `useSelect`.

## 7. Diagnostics

The rule has no autofix and no editor fix suggestions. Choosing among a narrow
child hook, a tracked selection, a class-side dependency, and `useTree` is an
architectural/performance decision; inserting any one automatically can change
render granularity or violate the Rules of Hooks.

Message IDs:

### `unobservedNodeRead`

> `{{readPath}}` reads fields owned by `{{ownerPath}}` during render. Current
> Retree React coverage (`{{observingHook}}` on `{{observedPath}}`) does not
> include that owner. Observe `{{ownerPath}}`, select the value, use `useTree`
> deliberately, or forward the change through `ReactiveNode.dependencies` /
> `@select`.

### `unobservedReactiveNodeRead` (deferred — Phase B)

> `{{readPath}}` reads a value typed as `ReactiveNode` during render without a
> proven Retree React observation. This opt-in check cannot prove that the
> instance is managed. If it is rooted, observe or select `{{ownerPath}}`; if it
> is intentionally unrooted, do not add a Retree hook.

This proposed message would exist only when the deferred
`checkReactiveNodeValues: true` option is implemented. It would be used for
statically identifiable `ReactiveNode` props/locals where no managed-origin
flow or hook established coverage. It deliberately does not prescribe
`useNode`, because that hook throws for an unrooted instance.

### `unobservedDirectRawChildRead`

> `{{readPath}}` reads data owned by the direct raw child
> `{{rawOwnerPath}}`, which `useRaw({{observedPath}})` does not invalidate.
> Convert that direct child with this hook's `toManaged` and observe it, select
> from the managed tree, or deliberately use `{ listenerType: "treeChanged" }`.

This message is used only when `rawOwnerPath` is statically a direct child of
the node passed to this exact `useRaw` call, where `toManaged` guarantees a
managed result.

### `unobservedRawRead`

> `{{readPath}}` reads deeper raw data that
> `useRaw({{observedPath}})` does not invalidate. `toManaged` does not guarantee
> resolution at `{{rawOwnerPath}}`. Restructure so the owner is a direct child
> of the subscribed node, select from the managed tree, or deliberately use
> `{ listenerType: "treeChanged" }`.

Neither raw message tells the user to pass a raw object directly to `useNode`,
and the deeper-path message never recommends a non-null assertion.

### `unobservedDerivedRead` (deferred — Phase B)

> `{{member}}` reads `{{dependencyPath}}`, which is not covered by this
> component's observation of `{{ownerPath}}`. Add a narrow observation or make
> the derived member reactive with `dependencies` / `@select`.

### `unobservedNodeSelectorRead` (deferred — Phase B)

> This node-form `useSelect` reads descendant `{{ownerPath}}`, but the selector
> does not return that node as a dependency and does not use `treeChanged`.
> Return the dependency, use the tracked selector form, or opt into
> `treeChanged`.

### `invalidAdditionalHook`

> Configured Retree hook `{{target}}#{{export}}` was encountered, but its export
> identity could not be resolved. Check `baseDirectory`, the file/package
> target, and the barrel export.

This is emitted once on the `Program` for a broken configured target that the
current file actually imports. It prevents a wrapper call from silently losing
analysis; an unused target is not resolved separately in every linted file.
The diagnostic deliberately remains per-file. Do not add module-level or
cross-file deduplication to compensate for ESLint caching: shared deduplication
would be incorrect under parallel linting, while `--cache` may inherently omit
the diagnostic on a later run when the importing file is unchanged.

Every message includes concrete source paths and the hook that established the
insufficient coverage. The highlighted range is the smallest field/member
access that first requires missing coverage. One maximal chain produces one
report to avoid cascades.

Intentional exceptions use ordinary ESLint disable comments with a required
description enforced by the consumer's ESLint configuration if desired:

```tsx
// eslint-disable-next-line @retreejs/no-unobserved-react-read -- external VM forwards owner.name
return <span>{state.owner.name}</span>;
```

The rule does not invent a Retree-specific suppression pragma.

## 8. Configuration and package surface

Phase A option schema:

```ts
interface HookBehavior {
    observes: "own" | "tree" | "raw-own" | "raw-tree";
    result?: "value" | "tuple-first";
}

type AdditionalHook = HookBehavior &
    ({ file: string; export: string } | { package: string; export: string });

interface Options {
    additionalHooks?: AdditionalHook[];
    baseDirectory?: string;
    checkJsxKeys?: boolean;
}
```

`file` identifies the module file that publicly exports the wrapper. An
absolute path is used as-is; a relative path is resolved from the explicit
absolute `baseDirectory`. Neither path depends on `tsconfigRootDir`, the process
working directory, nor whichever `tsconfig.json` Project Service selected for
the linted file.

The JSON schema validates field types and the mutually exclusive `file` /
`package` target shapes. It does not encode the cross-field relative-path rule.
At rule creation, validate each failure condition separately:

-   if `baseDirectory` is present but relative, throw
    `@retreejs/no-unobserved-react-read: baseDirectory must be absolute; received "{{baseDirectory}}".`;
-   if `additionalHooks[{{index}}].file` is relative and `baseDirectory` is
    absent, throw
    `@retreejs/no-unobserved-react-read: additionalHooks[{{index}}].file is relative ("{{file}}"), but baseDirectory is not configured. Fix: provide an absolute file path or set baseDirectory to an absolute path.`

These are runtime option validations with pinpointed errors, not lint
diagnostics or an `if`/`then` schema dependency.

ESLint flat config has a `basePath`, but the rule API does not expose that
config-object value to a plugin. Consumers should therefore pass the same
directory explicitly as `baseDirectory` (normally computed from
`import.meta.url`). This makes resolution stable under alternate config files,
editors, and monorepo packages instead of pretending there is one project root.

`package` identifies a public package import, including a local workspace
package, and is normally the better choice for published wrappers. Package
identity comes from the module specifier on the TypeScript-resolved import or
re-export edge in the call site's alias chain. It is never reconstructed from
the canonical declaration's real path or a `node_modules` path segment; that
would fail for symlinked workspace packages. The checker then matches the named
export and follows TypeScript alias/re-export chains without requiring
consumers to know the implementation declaration file.

Matching is strictly **call-site-driven**. For each candidate call, start from
its imported symbol, use the checker to follow already-loaded alias/re-export
symbols to a canonical declaration, and compare the encountered module/export
identities with normalized configuration keys. A configured `file` or
`package` is only a comparison key: the rule never calls
`Program.getSourceFile` to load that target, reads it independently, or causes
an otherwise-unloaded module to enter the program.

For a `file` entry, compare its normalized absolute path with the resolved file
identity already attached to an encountered import/re-export edge, using the
program's path canonicalization. For a `package` entry, compare the configured
package string with the public module specifier recorded on such an edge. Do
not derive one target kind from the other.

Both target forms identify an exported symbol, not merely its final declaration
location. A `file` target may name either a barrel such as `src/state/index.ts`
or the implementation module; the checker follows the configured export and
the call site's export through their TypeScript alias chains to a canonical
symbol. If an encountered import refers to a configured target but the named
export or its alias chain cannot be resolved, the rule emits one
`invalidAdditionalHook` configuration diagnostic on the `Program` instead of
silently ignoring the hook. Alias traversal consumes the normal analysis
budgets.

At a call site the rule compares resolved module/export identity — never local
spelling. Therefore aliases and namespace imports work without matching an
unrelated function of the same name. Entries are exact identities, not regular
expressions:

```js
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

{
    basePath: "apps/web",
    rules: {
        "@retreejs/no-unobserved-react-read": ["error", {
            baseDirectory: path.join(configDirectory, "apps/web"),
            additionalHooks: [
                {
                    file: "src/state/index.ts",
                    export: "useProjectNode",
                    observes: "own",
                    result: "value"
                },
                {
                    package: "@example/state",
                    export: "useWorkspaceTree",
                    observes: "tree",
                    result: "value"
                }
            ],
            checkJsxKeys: false
        }]
    }
}
```

`checkJsxKeys` defaults to `false` for the low-false-positive V1 policy in
section 3.3. `checkReactiveNodeValues` and built-in
`createRetreeContext(...).useRootContext` tracing are deferred; neither is part
of the Phase A schema.

The package exports:

-   `rules["no-unobserved-react-read"]`;
-   `configs["flat/recommended-type-checked"]`, initially enabling the rule as
    `warn` while it is dogfooded;
-   one ESM entry point and flat configuration only in V1, matching Retree's
    existing ESM-only package policy.

The package depends on `@typescript-eslint/utils` and peers on compatible
`eslint`, `@typescript-eslint/parser`, and `typescript` versions. It has no
runtime dependency on React or Retree; imports are recognized symbolically from
the consumer's TypeScript program.

Retree's current root `eslint.config.js` is CommonJS. Dogfooding this ESM-only
plugin requires converting that config to ESM (or an equivalent ESM config
entry); it is not justification for shipping a second CommonJS package build.

## 9. Analysis architecture and performance

### 9.1 Two passes, bounded work

Per source file:

1. **Collection pass:** resolve relevant imports, locate candidate component
   and custom-hook functions, collect known Retree origins/observations, and
   summarize local aliases.
2. **Validation pass:** visit render-phase reads, resolve their provenance,
   then ask the coverage graph whether the owning node is observed.

The rule uses `@typescript-eslint/utils` parser services and the existing
TypeScript `Program`; it must not construct a second program. Symbol resolution,
class summaries, and decorator summaries are cached by `ts.Symbol` in weak
maps for the life of that program.

Phase A also memoizes `resolveValue` by expression within each fixed-point
iteration and resets that cache whenever the value environment may change.
This avoids repeating recursive member/alias resolution without carrying stale
unknown results into a later iteration.

The current repository ESLint config parses TypeScript but does not enable
typed linting, and `npm run doctor` invokes ESLint only for paths under `src/`.
Before the rule can run here, add a dedicated typed-lint command using
`parserOptions.projectService` and explicit coverage for publishable packages,
React samples, `website/app/**`, and `website/components/**`. The prototype
command remains separate from `doctor` until its cost and signal are accepted;
otherwise enabling the experiment would silently change the performance and
file scope of the repository's required formatter/linter command.

The isolated baseline and dogfood scripts pass `--no-inline-config` because
they intentionally do not load unrelated Next/React lint plugins merely to
resolve source-level suppressions for rules that are not enabled. Published
consumer configurations do not impose that CLI flag.

No general call graph, project-wide scan, module execution, or independent
filesystem read is allowed from the rule. Same-file helpers are summarized
lazily. A candidate read may cause the checker to follow an already-loaded
TypeScript symbol into a source-visible declaration in another file, including
a context factory or configured hook barrel. That bounded, demand-driven
declaration traversal is the only cross-module analysis and is not a scan of
all project files.

Hard bounds:

-   four dependency-forwarding/helper edges;
-   32 source-visible symbols summarized for one maximal read;
-   one report per maximal read expression;
-   a visited-symbol set breaks recursion immediately.

Context member tracing and configured package/file re-export chains consume
these same edge and symbol budgets; they do not receive a separate allowance.

Exceeding a bound yields `unknown` and no diagnostic.

### 9.2 Performance gates

First record three separately named measurements:

1. today's untyped ESLint command (informational only);
2. the new typed-lint command with this rule disabled (the **rule baseline**);
3. the identical typed-lint command with this rule enabled.

The cost of moving from 1 to 2 is prerequisite/tooling cost and must be
reported, but it is not charged to the rule's incremental budget. Performance
gates compare 2 to 3:

-   median warm wall-clock overhead on the Retree repository: **no more than
    20%**;
-   p95 single-file rule time on representative 1,000-line TSX fixtures: **under
    25 ms** after the TypeScript program is available;
-   peak RSS increase on the repository: **under 50 MiB**;
-   a synthetic alias/collection fixture demonstrates approximately linear
    scaling from 100 to 10,000 relevant AST nodes;
-   ESLint's rule profiler is captured in CI for the benchmark fixture, but
    timing regressions fail only in the dedicated stable benchmark job.

If class/decorator analysis cannot meet these gates, ship the useful local
hook/path analysis first and leave class forwarding as an explicitly deferred
feature. Do not replace it with name-based guessing.

## 10. Test matrix

Use `@typescript-eslint/rule-tester` with `parserOptions.projectService`.

### 10.1 Phase A implemented matrix

1. direct scalar and nested reads from `useNode`;
2. aliases, object destructuring, optional chains, and statically known keys;
3. `useNode` chains with missing intermediate observation and `useTree`
   subtree coverage;
4. `useRaw` own/tree modes, tuple aliases, direct-child paired `toManaged`,
   deep non-null assertions, and direct/deep raw diagnostics;
5. arrays, synchronous array callbacks, `for...of`, object/array spread, and
   JSX spread;
6. child-node JSX transfers versus child-field reads, with JSX keys exempt by
   default and checked when configured;
7. deferred callback bodies versus render-time hook dependency arrays and
   `useMemo` initializers;
8. aliased/namespace Retree imports and unrelated same-named functions;
9. configured wrappers, call-site-driven file/package identity, broken-export
   diagnostics, and separate runtime errors for relative-path option failures;
10. real `ReactiveNode` subtypes degrade to unknown while ordinary application
    types with a field named `dependencies` remain analyzable;
11. duplicate suppression, actionable path text, typed flat-config loading,
    and ESM package loading.

### 10.2 Deferred matrix

-   guarded deep `toManaged` results;
-   Map/Set provenance and iteration, object/array rest, `Object.*`,
    `JSON.stringify`, and `structuredClone` whole-value consumers;
-   same-file custom-hook return summaries and nested named components that
    close over an outer hook result;
-   default/factory context tracing and the optional type-only `ReactiveNode`
    heuristic;
-   tracked and node-form `useSelect`;
-   `dependencies`, decorator, accessor, and method summaries;
-   extended analysis-limit, cycle, inheritance, and external-declaration
    fixtures for those deferred summaries.

The dedicated typed-lint integration command must explicitly run the rule
against every current Retree React sample and `website/app/**` /
`website/components/**`; it must not rely on `doctor`'s current `**/src/**`
glob. Every report must be classified as a real bug, an intentional exception
with a reason, or a rule defect before the config can move from `warn` to
`error`.

## 11. Acceptance and rollout

### Phase -1: fix the existing core warning

This is a current Retree correctness-of-diagnostics bug, independent of the
ESLint proposal. Fix it before reusing the helper in React:

-   Add a core dev-warning regression fixture where a `ReactiveNode` forwards
    `owner` through `dependencies`, and
    `Retree.select(project, (value) => value.owner.name, callback)` both updates
    correctly and emits no warning.
-   Add comparison-dependency and `@select` forwarding cases so the warning and
    runtime subscription semantics cannot drift independently.
-   Refactor `warnOnUnsubscribedDescendantReads` to compare tracked reads with
    effective forwarding coverage, not only the base raw node and nodes returned
    by the selection. If forwarding cannot be established at warning time, skip
    the ambiguous `ReactiveNode` warning rather than report correct code.
-   Preserve warnings for the existing plain-object unsafe selector case.

This phase fixes shippable-today warning noise. It should be delivered and
reviewed as a focused core change whether or not the ESLint experiment proceeds.

### Phase 0: React node-form `useSelect` dev warning

Before committing to the plugin, price the cheaper dynamic protection that is
currently missing from React:

-   In development and only for node-form `useSelect` with `nodeChanged`, run
    at least the initial selector evaluation through
    `collectTrackedSelectionAccesses`.
-   Compare the tracked descendant read nodes with the actual dependency
    sources derived from the returned selection, reusing the Phase -1
    forwarding-aware behavior from `Retree.select`.
-   Preserve the selector result and production behavior exactly; production
    performs no added tracking.
-   Document the first-evaluation boundary and test that later dynamic
    selector/source changes retain correct behavior even though this initial
    experiment does not warn on a branch first reached later.
-   Deduplicate the initial warning under Strict Mode.
-   Dogfood the warning and record how often it finds real mistakes. This is
    evidence for the value of the more expensive static rule.

This warning is independently useful but covers only node-form `useSelect`.
It cannot see ordinary component reads through `useNode`, missing hooks on
`ReactiveNode` props, raw render reads, or intermediate observation gaps.
Treat it as complementary evidence, not a substitute.

### Phase A-minus: typed-lint prerequisite and baseline

-   Add a dedicated `parserOptions.projectService` lint command without this
    rule enabled.
-   Explicitly cover packages, React samples, `website/app/**`, and
    `website/components/**`; do not inherit `doctor`'s `**/src/**` limitation.
-   Fix configuration/project-reference failures and record cold/warm time and
    peak memory. Keep this typed baseline separate from today's untyped lint
    result and from the rule's incremental benchmark.
-   Decide whether the dedicated command belongs in CI before integrating it
    into `doctor`.

### Phase A: feasibility prototype (not publishable)

-   Implement direct `useNode`/`useTree`/`useRaw` provenance,
    direct-child-safe paired `toManaged` conversion, aliases, arrays, JSX, and
    render/deferred phase separation. Context tracing, Map/Set provenance,
    known-call whole-value consumers, and the type-only `ReactiveNode`
    heuristic are not Phase A features.
-   Run it over this repository and at least one real downstream Retree app.
-   Record precision, missed known bugs, lint overhead, and the top unknown
    patterns.
-   Continue only if every reported case is actionable and the local algorithm
    catches the motivating nested-read examples.

### Phase B: Retree semantics

-   Add node-form `useSelect`, `dependencies`, decorator, accessor, and method
    summaries.
-   Add context tracing, same-file custom-hook summaries, Map/Set provenance,
    and the deferred whole-value consumers if they meet the performance gates.
-   Evaluate `checkReactiveNodeValues` as an opt-in heuristic. Keep it default
    off unless Retree gains a nominal type or other static fact that proves a
    value passed through `Retree.root`.
-   Add parity fixtures: any node-form selector source pattern understood by
    both the Phase 0 warning and the rule should receive the same safe/unsafe
    classification.
-   Keep the runtime warning; static analysis does not replace dynamic
    observation of real dependency sets.

### Phase C: public experimental package

-   Add package docs with the soundness boundary and examples from this spec.
-   Publish the rule only in `flat/recommended-type-checked` at `warn`.
-   Dogfood for one minor release across Retree and downstream apps.
-   Promote to `error` only after zero unexplained false positives and the
    performance gates hold on CI.

Before any implementation is considered complete, the repository's required
`npm test` and `npm run doctor` checks pass, along with typecheck, package build,
package-lint, rule tests, and the dedicated performance fixture.

## 12. Explicit limitations and non-goals

-   A `ReactiveNode` subtype proves class semantics, not that an instance was
    passed through `Retree.root`. The proof-based default therefore skips
    type-only values. The proposed `checkReactiveNodeValues` opt-in heuristic
    is deferred and its eventual diagnostic cannot promise that adding a hook
    is valid.
-   The rule cannot identify every managed plain-object prop because Retree
    deliberately preserves application types instead of returning a nominally
    branded node type.
-   The default `useRootContext<T>()` uses a caller assertion with no static
    provider-factory link, so its container members remain unknown. Only the
    paired `createRetreeContext<T>()` form is eligible for bounded declaration
    tracing.
-   It does not prove behavior through arbitrary imported helpers, reflection,
    proxies other than Retree's known APIs, mutation-built dependency arrays, or
    runtime decorator factories.
-   It does not validate the Rules of Hooks, general React dependency-array
    completeness, writes during render, raw writes, selector purity, or whether
    `useTree` is too broad. It checks only Retree observation of expressions
    that do appear in dependency arrays.
-   It does not auto-convert code to `useTree`; that can turn a correctness fix
    into a performance regression.
-   It does not claim that an unreported read is safe. It claims only that every
    reported read is provably missing observation under the modeled semantics.

These limits are why the proposed rule is worthwhile but not sufficient on its
own: the static rule gives fast, local, actionable feedback for the common
mistakes, while tracked selectors and the proposed Phase 0 warning retain
runtime visibility into dependency sets static analysis cannot prove.

## 13. Implementation references

-   [ESLint custom-rule contract](https://eslint.org/docs/latest/extend/custom-rules)
    for diagnostics, metadata, tests, and rule profiling.
-   [ESLint plugin contract](https://eslint.org/docs/latest/extend/plugins) for
    flat configs and published plugin shape.
-   [typescript-eslint custom rules](https://typescript-eslint.io/developers/custom-rules/)
    for `RuleCreator`, parser services, typed rules, and `RuleTester`.
-   [typescript-eslint plugin guidance](https://typescript-eslint.io/developers/eslint-plugins/)
    for typed-config and peer-dependency conventions.
-   [Project Service guidance](https://typescript-eslint.io/blog/project-service/)
    for typed-linting setup and monorepo performance.
-   [ESLint flat configuration files](https://eslint.org/docs/latest/use/configure/configuration-files)
    for config-object `basePath`; the rule still needs an explicit
    `baseDirectory` because `basePath` is not exposed through rule context.
