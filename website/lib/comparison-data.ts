/**
 * Shared comparison data for /why and /compare/* (spec §5.4).
 *
 * Honesty rules are hard requirements here:
 * - Every claim about MobX/Valtio/Zustand/Jotai comes from the verified
 *   facts in specs/website.md §5.4 (verified July 2026). Claims about Retree
 *   come from this repo's README and package source.
 * - Cells we could not verify are tier "not-scored" — a visible blank plus a
 *   footnote inviting corrections, never a guess.
 * - Rows Retree loses are included on purpose.
 */

export type LibraryId = "retree" | "mobx" | "valtio";

export type Tier =
    | "first-class"
    | "community"
    | "possible-with-work"
    | "absent"
    | "neutral"
    | "not-scored";

export interface TierInfo {
    /** Emoji marker from the spec's four-tier legend. */
    marker: string;
    name: string;
    /** Whether this tier appears in the legend (neutral/not-scored are explained separately). */
    inLegend: boolean;
}

export const TIERS: Record<Tier, TierInfo> = {
    "first-class": { marker: "✅", name: "First-class", inLegend: true },
    community: { marker: "🟡", name: "Community", inLegend: true },
    "possible-with-work": {
        marker: "🔶",
        name: "Possible with work",
        inLegend: true,
    },
    absent: { marker: "🛑", name: "Absent", inLegend: true },
    neutral: { marker: "", name: "Measured value", inLegend: false },
    "not-scored": { marker: "—", name: "Not scored", inLegend: false },
};

export interface ComparisonLibrary {
    id: LibraryId;
    name: string;
    /** Version line shown under the column header (verified July 2026). */
    detail: string;
}

export const COMPARISON_LIBRARIES: ComparisonLibrary[] = [
    { id: "retree", name: "Retree", detail: "@retreejs/core + react 0.5.1" },
    { id: "mobx", name: "MobX", detail: "6.16 + mobx-react-lite 4.1" },
    { id: "valtio", name: "Valtio", detail: "2.3" },
];

export const FOOTNOTES = {
    mobxActions:
        "MobX 6 expects writes to be wrapped in an action; enforceActions is on by default. Verified against MobX 6.16.",
    mobxObserver:
        "MobX requires observer() around every component that reads observables, and observables passed into non-observer children silently break reactivity.",
    valtioSnapSplit:
        "Valtio 2 splits the mutable proxy state from the frozen snap returned by useSnapshot. Its own docs list the resulting gotchas: React.memo children can over-render when passed snapshots they never accessed, controlled inputs need sync: true, and object getters are uncached and resolve against siblings only.",
    treeSemantics:
        "Neither MobX core nor Valtio has tree semantics; MobX defers to mobx-state-tree, a separate schema-based layer (see the mobx-state-tree note).",
    mobxComputed:
        "Credit where due: MobX's computed engine is best-in-class, with a decade of production hardening behind it.",
    backendClaim:
        "The precise claim: no official backend integration exists for MobX or Valtio, while @retreejs/convex is first-party. Community-built bindings may exist for either library.",
    bundleMethod:
        "Measured by us with esbuild, minified + gzip, react and react-dom externalized, July 2026 — same method for every library. Full set: @retreejs/core 18.6 kB; core + react 19.6 kB; mobx 18.5 kB; mobx + mobx-react-lite 20.2 kB; valtio 2.7 kB; zustand 0.4 kB. Retree is comparable to the MobX stack; Valtio and Zustand are far smaller. The difference is what ships in the bytes: per-node subscriptions, tree operations, view models, transactions, and the Convex integration.",
    notScored:
        "Not scored: every scored cell in this table was verified against the listed versions, and this one has not been through that check yet — a blank beats a guess. Corrections via PR are welcome.",
    concurrentReact:
        "Retree's hooks subscribe with useState + useEffect, not useSyncExternalStore. See the trade-offs section on /why for exactly what has and has not been validated.",
    retreeCoreOutsideReact:
        "@retreejs/core runs without React (Retree.root, Retree.on, Retree.select), but React is the only first-class view binding today.",
    retreeLoses:
        "MobX and Valtio have years of production mileage; Retree is v0.4.x. The counterweight is auditability: the API surface is small, and the test suite and benchmark harness are open in the repo.",
    devtoolsNote:
        "Valtio ships Redux DevTools support; Retree has no devtools today. Retree.on subscriptions are the current way to observe changes programmatically.",
} as const;

export type FootnoteId = keyof typeof FOOTNOTES;

export interface ComparisonCell {
    tier: Tier;
    label: string;
    footnotes?: FootnoteId[];
}

export interface ComparisonRow {
    id: string;
    feature: string;
    /** Marks rows where Retree is honestly behind. */
    retreeLoses?: boolean;
    cells: Record<LibraryId, ComparisonCell>;
}

const notScored: ComparisonCell = {
    tier: "not-scored",
    label: "Not verified",
    footnotes: ["notScored"],
};

export const COMPARISON_ROWS: ComparisonRow[] = [
    {
        id: "mutation-model",
        feature: "Mutation model",
        cells: {
            retree: {
                tier: "first-class",
                label: "Plain assignment on plain objects and classes",
            },
            mobx: {
                tier: "first-class",
                label: "Mutable observables; writes wrapped in action",
                footnotes: ["mobxActions"],
            },
            valtio: {
                tier: "first-class",
                label: "Mutate proxy state; render from a frozen snap",
                footnotes: ["valtioSnapSplit"],
            },
        },
    },
    {
        id: "granularity",
        feature: "Subscription granularity",
        cells: {
            retree: {
                tier: "first-class",
                label: "Per node — you pick with useNode / useTree / useSelect / useRaw",
            },
            mobx: {
                tier: "first-class",
                label: "Reads tracked inside observer()",
                footnotes: ["mobxObserver"],
            },
            valtio: {
                tier: "first-class",
                label: "Access-tracked snapshots",
                footnotes: ["valtioSnapSplit"],
            },
        },
    },
    {
        id: "tree-alignment",
        feature: "Nested stores that match the component tree",
        cells: {
            retree: {
                tier: "first-class",
                label: "The core idea — subscribe to any node in one tree",
            },
            mobx: {
                tier: "possible-with-work",
                label: "Top-level store orientation",
                footnotes: ["treeSemantics"],
            },
            valtio: {
                tier: "possible-with-work",
                label: "Top-level store orientation",
                footnotes: ["treeSemantics"],
            },
        },
    },
    {
        id: "no-hoc",
        feature: "Hooks without HOC wrappers",
        cells: {
            retree: { tier: "first-class", label: "Hooks only" },
            mobx: {
                tier: "absent",
                label: "observer() required on every reading component",
                footnotes: ["mobxObserver"],
            },
            valtio: { tier: "first-class", label: "useSnapshot hook" },
        },
    },
    {
        id: "classes",
        feature: "Class instances as state",
        cells: {
            retree: {
                tier: "first-class",
                label: "Classes and plain objects, no registration call",
            },
            mobx: {
                tier: "first-class",
                label: "makeAutoObservable(this)",
            },
            valtio: notScored,
        },
    },
    {
        id: "decorators",
        feature: "Optional decorators",
        cells: {
            retree: {
                tier: "first-class",
                label: "Standard 2023-11 decorators: @select, @memo, @ignore, @link — always optional",
            },
            mobx: notScored,
            valtio: notScored,
        },
    },
    {
        id: "computed",
        feature: "Computed / memoized values",
        cells: {
            retree: {
                tier: "first-class",
                label: "memo, @memo, @fnMemo, @select",
            },
            mobx: {
                tier: "first-class",
                label: "Best-in-class computed engine",
                footnotes: ["mobxComputed"],
            },
            valtio: {
                tier: "possible-with-work",
                label: "Getters are uncached and siblings-only",
                footnotes: ["valtioSnapSplit"],
            },
        },
    },
    {
        id: "transactions",
        feature: "Transactions & silent writes",
        cells: {
            retree: {
                tier: "first-class",
                label: "Retree.runTransaction, Retree.runSilent",
            },
            mobx: notScored,
            valtio: notScored,
        },
    },
    {
        id: "tree-ops",
        feature: "Tree operations: parent / move / clone / link",
        cells: {
            retree: {
                tier: "first-class",
                label: "Built in: Retree.parent, move, clone, link",
            },
            mobx: {
                tier: "absent",
                label: "Not in core — defers to mobx-state-tree",
                footnotes: ["treeSemantics"],
            },
            valtio: {
                tier: "absent",
                label: "No tree semantics",
                footnotes: ["treeSemantics"],
            },
        },
    },
    {
        id: "escape-hatches",
        feature: "Escape hatches for hot paths",
        cells: {
            retree: {
                tier: "first-class",
                label: "Retree.raw, useRaw, peekInto, untracked",
            },
            mobx: notScored,
            valtio: notScored,
        },
    },
    {
        id: "backend",
        feature: "First-party backend integration",
        cells: {
            retree: {
                tier: "first-class",
                label: "@retreejs/convex (Convex)",
                footnotes: ["backendClaim"],
            },
            mobx: {
                tier: "absent",
                label: "No official backend integration",
                footnotes: ["backendClaim"],
            },
            valtio: {
                tier: "absent",
                label: "No official backend integration",
                footnotes: ["backendClaim"],
            },
        },
    },
    {
        id: "devtools",
        feature: "Devtools",
        retreeLoses: true,
        cells: {
            retree: {
                tier: "absent",
                label: "None today",
                footnotes: ["devtoolsNote"],
            },
            mobx: notScored,
            valtio: {
                tier: "first-class",
                label: "Redux DevTools",
            },
        },
    },
    {
        id: "concurrent-react",
        feature: "Concurrent React (useSyncExternalStore)",
        cells: {
            retree: {
                tier: "possible-with-work",
                label: "useState + useEffect subscriptions; no useSyncExternalStore yet",
                footnotes: ["concurrentReact"],
            },
            mobx: notScored,
            valtio: notScored,
        },
    },
    {
        id: "ts-inference",
        feature: "TypeScript inference",
        cells: {
            retree: {
                tier: "first-class",
                label: "Hooks return your object's own type",
            },
            mobx: notScored,
            valtio: notScored,
        },
    },
    {
        id: "bundle-size",
        feature: "Bundle size (min+gzip, measured by us)",
        cells: {
            retree: {
                tier: "neutral",
                label: "19.6 kB (core + react)",
                footnotes: ["bundleMethod"],
            },
            mobx: {
                tier: "neutral",
                label: "20.2 kB (mobx + mobx-react-lite)",
                footnotes: ["bundleMethod"],
            },
            valtio: {
                tier: "neutral",
                label: "2.7 kB",
                footnotes: ["bundleMethod"],
            },
        },
    },
    {
        id: "ecosystem",
        feature: "Ecosystem & community resources",
        retreeLoses: true,
        cells: {
            retree: {
                tier: "absent",
                label: "Young — this site and the repo are the resources today",
                footnotes: ["retreeLoses"],
            },
            mobx: { tier: "first-class", label: "Established" },
            valtio: { tier: "first-class", label: "Established" },
        },
    },
    {
        id: "track-record",
        feature: "Production track record",
        retreeLoses: true,
        cells: {
            retree: {
                tier: "absent",
                label: "v0.4.x — no known large deployments",
                footnotes: ["retreeLoses"],
            },
            mobx: {
                tier: "first-class",
                label: "A decade of hardening",
                footnotes: ["mobxComputed"],
            },
            valtio: { tier: "first-class", label: "Established" },
        },
    },
    {
        id: "framework-agnostic",
        feature: "Framework-agnostic usage beyond React",
        retreeLoses: true,
        cells: {
            retree: {
                tier: "possible-with-work",
                label: "Core runs anywhere; React is the only first-class binding",
                footnotes: ["retreeCoreOutsideReact"],
            },
            mobx: { tier: "first-class", label: "Yes" },
            valtio: { tier: "first-class", label: "Yes" },
        },
    },
    {
        id: "redux-devtools",
        feature: "Redux DevTools support",
        retreeLoses: true,
        cells: {
            retree: {
                tier: "absent",
                label: "No",
                footnotes: ["devtoolsNote"],
            },
            mobx: notScored,
            valtio: { tier: "first-class", label: "Yes" },
        },
    },
];

/** Footnote ids in order of first appearance for the given columns. */
export function collectFootnoteOrder(columns: LibraryId[]): FootnoteId[] {
    const seen: FootnoteId[] = [];
    for (const row of COMPARISON_ROWS) {
        for (const column of columns) {
            const cell = row.cells[column];
            if (cell.footnotes === undefined) continue;
            for (const id of cell.footnotes) {
                if (!seen.includes(id)) seen.push(id);
            }
        }
    }
    return seen;
}
