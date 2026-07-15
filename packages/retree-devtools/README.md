# Retree DevTools

`@retreejs/devtools` connects Retree reactive state to the [Redux DevTools Extension](https://github.com/reduxjs/redux-devtools): every write shows up as an action with its change records, transactions batch into one action, state snapshots make the extension's inspector and time travel work, and `createChangeLogTap` exposes the same structured stream for custom tooling.

## How to install

```bash
npm i @retreejs/core @retreejs/devtools
```

Install the Redux DevTools Extension in your browser ([Chrome](https://chromewebstore.google.com/detail/redux-devtools/lmhkpmbekcpmknklioeibfkpmmfibljd), [Firefox](https://addons.mozilla.org/en-US/firefox/addon/reduxdevtools/)). When the extension is absent, `connectReduxDevTools` is a safe no-op — it returns a disconnected handle and logs one dev-mode `console.info`.

## How to use

Pass your roots with names; the connection registers them via `Retree.registerRootName` and scopes inspection to exactly those roots:

```ts
import { Retree } from "@retreejs/core";
import { connectReduxDevTools } from "@retreejs/devtools";

const app = Retree.root({ count: 0, tasks: [{ title: "ship", done: false }] });

const devtools = connectReduxDevTools({
    name: "My App",
    roots: { app },
});

app.count = 1; // action "app/Object.count"
Retree.runTransaction(() => {
    app.tasks[0].done = true;
    app.count = 2;
}); // one "transaction" action containing both changes

// on teardown (hot reload, tests)
devtools.dispose();
```

Omit `roots` to inspect every root already registered with `Retree.registerRootName`.

### Vite

Connect only in development so production bundles pay nothing:

```ts
if (import.meta.env.DEV) {
    connectReduxDevTools({ roots: { app } });
}
```

### Next.js

The extension lives in the browser, so connect from a client module (the call is harmless during SSR — no extension global exists on the server, so it no-ops):

```tsx
"use client";

import { useEffect } from "react";
import { connectReduxDevTools } from "@retreejs/devtools";
import { app } from "../state/app";

export function DevToolsBridge() {
    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;
        const devtools = connectReduxDevTools({ roots: { app } });
        return () => devtools.dispose();
    }, []);
    return null;
}
```

Render `<DevToolsBridge />` once near the root of your layout.

## What time travel does and doesn't do

Clicking **Jump** on an action reconciles the extension's recorded state back into your roots, in one `Retree.runTransaction`, preserving node identities — objects and arrays are updated in place, so `Retree.on` listeners and React subscriptions survive the jump.

Honest limits:

-   **JSON-representable state only.** The extension serializes state through JSON. Primitives, plain objects, and arrays round-trip exactly. `Map`, `Set`, and `Date` values do not — on a jump they keep their **current** contents, and a dev-mode warning reports the first skipped path.
-   **Class instances are updated field-by-field, never rebuilt.** JSON carries no prototype information, so a jump rewrites the data fields the recorded state has but never deletes fields from or replaces a class instance.
-   **Snapshots are required.** With `stateSnapshots: false` there is no recorded state, so jumps are ignored (with a dev-mode warning).
-   **Fully-silent writes are invisible.** Default `Retree.runSilent(fn)` suppresses emission entirely, so those writes appear in neither the action list nor jump targets. `Retree.runSilent(fn, false)` writes are recorded and flagged `silent` in the action payload.

`JUMP_TO_ACTION` and `JUMP_TO_STATE` are the supported time-travel messages. Other monitor commands (commit, sweep, action skipping/reordering) are ignored.

## Performance guidance

Taps run **synchronously inside the write path**, before application listeners — everything here is for development builds.

-   Every action attaches a `structuredClone` of every inspected root by default: `O(total state size)` per write. For large trees or write-heavy paths, set `stateSnapshots: false` (you keep the action stream, lose the state inspector and time travel), lower `maxAge`, or scope `roots` to the trees you are debugging.
-   Transactions cost one snapshot per window, not per write — batch bursty writes with `Retree.runTransaction` anyway (good advice with or without devtools).
-   `createChangeLogTap` resolves a key path per emission by walking the node's parents (`O(depth × width)`); pass `{ paths: false }` to skip it.

## Custom tooling: `createChangeLogTap`

The documented low-level API. Each Retree emission — including `runSilent(fn, false)` writes application listeners never see — becomes one structured entry:

```ts
import { createChangeLogTap } from "@retreejs/devtools";

const removeTap = createChangeLogTap((entry) => {
    // { kind, rootName, path, records, transaction, silent }
    myLogger.debug(
        `${entry.rootName ?? "anonymous"}.${entry.path?.join(".") ?? "?"}`,
        entry.records
    );
});

// later
removeTap();
```

`records` are the raw `INodeFieldChanges` exactly as Retree listeners receive them — raw values with structural `op` markers — so entries can feed `Retree.applyInverse` / `Retree.applyChanges`, persistence, or your own panel. Keep sinks passive: a slow sink slows every write, and a sink that mutates Retree state re-enters the emit path.

## Docs

Docs are hosted at https://www.retree.dev — see the [DevTools guide](https://www.retree.dev/docs/devtools).

## Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved. Licensed under MIT license.
