import {
    COMPARISON_LIBRARIES,
    COMPARISON_ROWS,
    FOOTNOTES,
    TIERS,
    collectFootnoteOrder,
    type ComparisonCell,
    type FootnoteId,
    type LibraryId,
} from "@/lib/comparison-data";

export interface ComparisonTableProps {
    /** Which library columns to show; defaults to all. Retree is always first. */
    columns?: LibraryId[];
}

function CellContent({
    cell,
    footnoteNumber,
}: {
    cell: ComparisonCell;
    footnoteNumber: (id: FootnoteId) => number;
}) {
    const tier = TIERS[cell.tier];
    return (
        <div className="flex items-start gap-1.5">
            {tier.marker !== "" ? (
                <span aria-hidden className="shrink-0 text-xs leading-5">
                    {tier.marker}
                </span>
            ) : null}
            <span className="sr-only">{tier.name}:</span>
            <span>
                {cell.label}
                {cell.footnotes?.map((id) => (
                    <sup key={id} className="ml-0.5">
                        <a
                            href={`#fn-${id}`}
                            className="text-accent no-underline hover:underline"
                            aria-label={`Footnote ${footnoteNumber(id)}`}
                        >
                            {footnoteNumber(id)}
                        </a>
                    </sup>
                ))}
            </span>
        </div>
    );
}

/**
 * The shared honest comparison table (spec §5.4). One table, four-tier
 * legend, footnotes for nuance, rows Retree loses included, accuracy pledge
 * with a PR invitation. Data lives in lib/comparison-data.ts so /why and
 * /compare/* render the same facts.
 */
export function ComparisonTable({ columns }: ComparisonTableProps) {
    const visibleColumns: LibraryId[] =
        columns ?? COMPARISON_LIBRARIES.map((library) => library.id);
    const libraries = COMPARISON_LIBRARIES.filter((library) =>
        visibleColumns.includes(library.id)
    );
    const footnoteOrder = collectFootnoteOrder(visibleColumns);
    const footnoteNumber = (id: FootnoteId) => footnoteOrder.indexOf(id) + 1;

    return (
        <div>
            {/* Legend */}
            <div
                className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-lg border border-border-token bg-surface px-4 py-3"
                aria-label="Legend"
            >
                {Object.values(TIERS)
                    .filter((tier) => tier.inLegend)
                    .map((tier) => (
                        <span
                            key={tier.name}
                            className="font-mono text-xs text-muted"
                        >
                            <span aria-hidden>{tier.marker}</span> {tier.name}
                        </span>
                    ))}
                <span className="font-mono text-xs text-muted">
                    <span aria-hidden>—</span> Not scored (unverified — see
                    pledge below)
                </span>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-border-token">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b border-border-strong bg-surface">
                            <th
                                scope="col"
                                className="px-4 py-3 font-mono text-xs uppercase tracking-widest text-faint"
                            >
                                Feature
                            </th>
                            {libraries.map((library) => (
                                <th
                                    key={library.id}
                                    scope="col"
                                    className="px-4 py-3 align-top"
                                >
                                    <span className="block font-semibold text-foreground">
                                        {library.name}
                                    </span>
                                    <span className="block font-mono text-[11px] font-normal text-faint">
                                        {library.detail}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {COMPARISON_ROWS.map((row) => (
                            <tr
                                key={row.id}
                                className="border-b border-border-token last:border-b-0 odd:bg-background even:bg-surface"
                            >
                                <th
                                    scope="row"
                                    className="px-4 py-3 align-top text-sm font-medium text-foreground"
                                >
                                    {row.feature}
                                    {row.retreeLoses === true ? (
                                        <span className="mt-0.5 block font-mono text-[10px] font-normal uppercase tracking-widest text-faint">
                                            Retree trails here
                                        </span>
                                    ) : null}
                                </th>
                                {libraries.map((library) => (
                                    <td
                                        key={library.id}
                                        className="px-4 py-3 align-top text-muted"
                                    >
                                        <CellContent
                                            cell={row.cells[library.id]}
                                            footnoteNumber={footnoteNumber}
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Footnotes */}
            {footnoteOrder.length > 0 ? (
                <ol className="mt-4 space-y-2 text-xs leading-5 text-muted">
                    {footnoteOrder.map((id, index) => (
                        <li
                            key={id}
                            id={`fn-${id}`}
                            className="flex gap-2 scroll-mt-24"
                        >
                            <span className="font-mono text-faint">
                                {index + 1}.
                            </span>
                            <span>{FOOTNOTES[id]}</span>
                        </li>
                    ))}
                </ol>
            ) : null}

            {/* Accuracy pledge */}
            <div className="mt-6 rounded-lg border border-border-token bg-surface p-4">
                <p className="font-mono text-xs uppercase tracking-widest text-faint">
                    Accuracy pledge
                </p>
                <p className="mt-2 text-sm leading-6 text-muted">
                    Comparison tables rot. Every claim above was verified
                    against the listed versions in July 2026, and cells we could
                    not verify are left unscored rather than guessed. Bundle
                    sizes are our own measurements: esbuild, minified + gzip,
                    react and react-dom externalized, July 2026, same method for
                    every library. If anything here is wrong, stale, or unfair
                    to another library,{" "}
                    <a
                        href="https://github.com/ryanbliss/retree"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent underline underline-offset-2 hover:no-underline"
                    >
                        open an issue or submit a PR
                    </a>{" "}
                    — corrections are merged gladly.
                </p>
            </div>
        </div>
    );
}

/**
 * Dedicated mobx-state-tree note (spec §5.4): the closest competitor on tree
 * semantics gets named head-on rather than omitted.
 */
export function MobxStateTreeNote() {
    return (
        <div className="rounded-lg border border-border-token bg-surface p-4">
            <p className="font-mono text-xs uppercase tracking-widest text-faint">
                What about mobx-state-tree?
            </p>
            <p className="mt-2 text-sm leading-6 text-muted">
                mobx-state-tree is the closest competitor to Retree on tree
                semantics, and it deserves the mention. It is a separate,
                schema-based layer over MobX: you define typed models up front
                and get a managed state tree in return. Retree aims at the same
                tree-shaped problems without the schema layer — nodes are your
                own plain objects and class instances, typed by TypeScript
                inference rather than a runtime model definition, and components
                subscribe through hooks instead of{" "}
                <code className="font-mono text-[0.85em] text-foreground">
                    observer()
                </code>
                . If you want runtime-enforced schemas for your tree,
                mobx-state-tree is the established choice; if you want the tree
                without the schemas, that is exactly the gap Retree exists to
                fill.
            </p>
        </div>
    );
}
