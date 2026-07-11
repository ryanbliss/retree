"use client";

import type { ReactNode } from "react";
import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";
import { RenderBadge } from "@/components/visualizer/RenderBadge";
import { useRenderGlow } from "@/components/visualizer/useRenderGlow";

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
 * An operation button. Unmistakably a button: raised surface, strong
 * border, a leading run glyph, hover/active states, and a pointer cursor.
 * Non-interactive annotations in this demo are plain unbordered text.
 */
function OpButton({
    onClick,
    children,
    ariaLabel,
    danger = false,
}: {
    onClick: () => void;
    children: ReactNode;
    ariaLabel: string;
    danger?: boolean;
}) {
    const hoverTone = danger
        ? "hover:border-[color:var(--danger)] hover:text-danger"
        : "hover:border-[color:var(--accent-glow)] hover:text-accent";
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised px-2 py-1 font-mono text-[11px] text-foreground shadow-sm transition-[color,border-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97] ${hoverTone}`}
        >
            <span
                aria-hidden
                className={`text-[9px] ${
                    danger ? "text-danger" : "text-accent"
                }`}
            >
                ▶
            </span>
            {children}
        </button>
    );
}

/**
 * Feature-walk demo 3: `Retree.move` transfers a task between the two list
 * nodes, and `Retree.parent` + `splice` removes one in place. Only the
 * lists whose contents changed re-render.
 *
 * The shell deliberately carries no render badge: it has no subscription,
 * so its count would sit at 1 forever — a number that helps nobody compare
 * anything. The per-list badges below are the evidence.
 */
export function TreeOpsDemo() {
    const reset = (): void => {
        const fresh = createInitialColumns();
        board.backlog.splice(0, board.backlog.length, ...fresh.backlog);
        board.active.splice(0, board.active.length, ...fresh.active);
    };

    return (
        <div className="rounded-xl border border-border-token bg-surface p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-faint">
                    {"<Parent />"} — no subscription
                </span>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-muted">
                Click an operation (
                <span aria-hidden className="font-mono text-[10px] text-accent">
                    ▶
                </span>
                ) to run it against the tree below — then check which render
                counters moved.
            </p>
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
                <OpButton onClick={reset} ariaLabel="Reset the demo board">
                    reset()
                </OpButton>
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
            className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-token bg-surface px-2 py-1.5"
        >
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {state.title}
            </span>
            <RenderBadge renders={renders} />
            <OpButton
                onClick={move}
                ariaLabel={`Move "${state.title}" to ${otherLabel}`}
            >
                move
            </OpButton>
            <OpButton
                onClick={remove}
                ariaLabel={`Delete "${state.title}"`}
                danger
            >
                ✕
            </OpButton>
        </li>
    );
}
