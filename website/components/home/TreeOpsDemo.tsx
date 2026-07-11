"use client";

import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";
import { RenderBadge } from "@/components/visualizer/RenderBadge";
import { useRenderGlow } from "@/components/visualizer/useRenderGlow";
import { DemoButton } from "./DemoButton";

interface OpsTask {
    id: number;
    title: string;
}

function createInitialColumns(): { backlog: OpsTask[]; active: OpsTask[] } {
    return {
        backlog: [
            { id: 1, title: "Design the schema" },
            { id: 2, title: "Write the parser" },
            { id: 3, title: "Add benchmarks" },
        ],
        active: [{ id: 4, title: "Fix the flaky test" }],
    };
}

/** Real Retree tree backing feature demo 3 (tree operations). */
const board = Retree.root(createInitialColumns());

/**
 * Feature-walk demo 3: `Retree.move` transfers a task between the two list
 * nodes, and `Retree.parent` + `splice` removes one in place. Only the
 * lists whose contents changed re-render.
 */
export function TreeOpsDemo() {
    // Shell has no subscription: its render counter should stay at 1.
    const { ref, renders } = useRenderGlow<HTMLDivElement>();

    const reset = (): void => {
        const fresh = createInitialColumns();
        board.backlog.splice(0, board.backlog.length, ...fresh.backlog);
        board.active.splice(0, board.active.length, ...fresh.active);
    };

    return (
        <div
            ref={ref}
            className="rounded-xl border border-border-token bg-surface p-3 sm:p-4"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-faint">
                    parent — no subscription
                </span>
                <RenderBadge renders={renders} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <BoardColumn
                    label="backlog"
                    list={board.backlog}
                    otherList={board.active}
                    otherLabel="active"
                />
                <BoardColumn
                    label="active"
                    list={board.active}
                    otherList={board.backlog}
                    otherLabel="backlog"
                />
            </div>
            <div className="mt-3">
                <DemoButton onClick={reset} ariaLabel="Reset the demo board">
                    reset()
                </DemoButton>
            </div>
        </div>
    );
}

function BoardColumn({
    label,
    list,
    otherList,
    otherLabel,
}: {
    label: string;
    list: OpsTask[];
    otherList: OpsTask[];
    otherLabel: string;
}) {
    const tasks = useNode(list);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div
            ref={ref}
            className="rounded-lg border border-border-token bg-background p-2.5"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-faint">
                    useNode(board.{label})
                </span>
                <RenderBadge renders={renders} />
            </div>
            {tasks.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-border-token px-2 py-2 font-mono text-[11px] text-faint">
                    empty
                </p>
            ) : (
                <ul className="mt-2 space-y-1.5">
                    {tasks.map((task) => (
                        <BoardRow
                            key={task.id}
                            task={task}
                            otherList={otherList}
                            otherLabel={otherLabel}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}

function BoardRow({
    task,
    otherList,
    otherLabel,
}: {
    task: OpsTask;
    otherList: OpsTask[];
    otherLabel: string;
}) {
    const state = useNode(task);
    const { ref, renders } = useRenderGlow<HTMLLIElement>();

    const move = (): void => {
        Retree.move(state, otherList);
    };

    const remove = (): void => {
        const parent = Retree.parent(state);
        if (!Array.isArray(parent)) {
            throw new Error(
                `TreeOpsDemo: expected task ${state.id} ("${state.title}") to live in an array, but Retree.parent returned a non-array parent.`
            );
        }
        const index = parent.findIndex(
            (entry: OpsTask) => entry.id === state.id
        );
        if (index === -1) {
            throw new Error(
                `TreeOpsDemo: task ${state.id} ("${state.title}") was not found in its parent array during removal.`
            );
        }
        parent.splice(index, 1);
    };

    return (
        <li
            ref={ref}
            className="flex items-center gap-1.5 rounded-md border border-border-token bg-surface px-2 py-1.5"
        >
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {state.title}
            </span>
            <RenderBadge renders={renders} />
            <button
                type="button"
                onClick={move}
                aria-label={`Move "${state.title}" to ${otherLabel}`}
                className="rounded border border-border-token px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
                move
            </button>
            <button
                type="button"
                onClick={remove}
                aria-label={`Delete "${state.title}"`}
                className="rounded border border-border-token px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-border-strong hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
                ×
            </button>
        </li>
    );
}
