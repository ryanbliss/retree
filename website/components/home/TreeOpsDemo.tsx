"use client";

import { memo, useState, type ReactNode } from "react";
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    pointerWithin,
    useDndMonitor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { Retree, RetreeLink } from "@retreejs/core";
import { useNode, useSelect } from "@retreejs/react";
import { BurstRenderBadge } from "@/components/visualizer/BurstRenderBadge";
import { useRenderGlow } from "@/components/visualizer/useRenderGlow";

interface OpsTask {
    id: number;
    title: string;
}

interface OpsBoard {
    backlog: OpsTask[];
    active: OpsTask[];
    selected: RetreeLink<OpsTask> | null;
}

type ColumnKey = "backlog" | "active";

const COLUMN_KEYS: ColumnKey[] = ["backlog", "active"];

function createInitialColumns(): Pick<OpsBoard, "backlog" | "active"> {
    return {
        backlog: [
            { id: 1, title: "Design the schema" },
            { id: 2, title: "Write the parser" },
            { id: 3, title: "Add benchmarks" },
        ],
        active: [{ id: 4, title: "Ship v1.0" }],
    };
}

/** Real Retree tree backing feature demo 3 (tree operations). */
const board = Retree.root<OpsBoard>({
    ...createInitialColumns(),
    selected: null,
});

/** Clones get fresh ids — they are independent copies, not the same card. */
let nextTaskId = 5;

/** The last tree operation that ran, printed as the call it maps to. */
const opLog = Retree.root({ line: "" });

function findTask(id: number): { task: OpsTask; column: ColumnKey } | null {
    for (const column of COLUMN_KEYS) {
        const task = board[column].find((entry) => entry.id === id);
        if (task !== undefined) return { task, column };
    }
    return null;
}

/* ------------------------------ operations ------------------------------ */

function moveTask(id: number, column: ColumnKey, index?: number): void {
    const found = findTask(id);
    if (found === null) {
        throw new Error(
            `TreeOpsDemo: task ${id} was not found in either column when handling a drop.`
        );
    }
    const from = found.column;
    const fromIndex = board[from].indexOf(found.task);
    if (from === column && (index === undefined || index === fromIndex)) {
        return; // dropped back where it started — nothing to do
    }
    Retree.move(found.task, board[column], index);
    opLog.line = `Retree.move(task, board.${column}${
        index === undefined ? "" : `, ${index}`
    })`;
}

function linkTask(id: number): void {
    const found = findTask(id);
    if (found === null) {
        throw new Error(
            `TreeOpsDemo: task ${id} was not found in either column when linking it.`
        );
    }
    if (board.selected?.current.id === id) {
        board.selected = null;
        opLog.line = "board.selected = null";
        return;
    }
    board.selected = Retree.link(found.task);
    opLog.line = "board.selected = Retree.link(task)";
}

function cloneTask(id: number): void {
    const found = findTask(id);
    if (found === null) {
        throw new Error(
            `TreeOpsDemo: task ${id} was not found in either column when cloning it.`
        );
    }
    // clone returns a detached copy — give it its own identity before it
    // joins the tree as a new structural child.
    const copy = Retree.clone(found.task);
    copy.id = nextTaskId;
    nextTaskId += 1;
    copy.title = `${found.task.title} (copy)`;
    board[found.column].push(copy);
    opLog.line = `board.${found.column}.push(Retree.clone(task))`;
}

function removeTask(task: OpsTask): void {
    // The whole point: delete without knowing which list owns the task.
    const parent = Retree.parent(task);
    if (!Array.isArray(parent)) {
        throw new Error(
            `TreeOpsDemo: expected task ${task.id} ("${task.title}") to live in an array, but Retree.parent returned a non-array parent.`
        );
    }
    const index = parent.findIndex((entry: OpsTask) => entry.id === task.id);
    if (index === -1) {
        throw new Error(
            `TreeOpsDemo: task ${task.id} ("${task.title}") was not found in its parent array during removal.`
        );
    }
    if (board.selected?.current.id === task.id) {
        board.selected = null;
    }
    parent.splice(index, 1);
    opLog.line = "Retree.parent(task).splice(index, 1)";
}

function resetBoard(): void {
    const fresh = createInitialColumns();
    board.selected = null;
    board.backlog.splice(0, board.backlog.length, ...fresh.backlog);
    board.active.splice(0, board.active.length, ...fresh.active);
    nextTaskId = 5;
    opLog.line = "reset()";
}

/** Module-scope drop handler: the shell never re-renders for drag state. */
function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (over === null) return;
    const overData = over.data.current;
    if (overData === undefined) return;
    const column = overData.column as ColumnKey;
    const index = overData.index as number | undefined;
    moveTask(Number(active.id), column, index);
}

/* -------------------------------- markup -------------------------------- */

/**
 * Feature-walk demo 3: a two-column kanban where dropping a card runs one
 * `Retree.move` — cross-column or reordered in place — plus link, clone,
 * and parent-based delete on each card. Only the lists whose contents
 * changed re-render; the per-column and per-card badges are the evidence.
 *
 * dnd-kit's DragOverlay carries the visual while dragging; state doesn't
 * change until the drop, so one drag is exactly one tree operation. The
 * counted components (column contents, card contents) are memo-isolated
 * from dnd-kit's context churn so drag plumbing never bumps a badge.
 */
export function TreeOpsDemo() {
    const sensors = useSensors(
        // A small activation distance keeps the card buttons clickable.
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor)
    );

    return (
        <div className="flex h-full flex-col rounded-xl border border-border-token bg-surface p-3 shadow-[var(--glass-shadow)] sm:p-4">
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-faint">
                    <span aria-hidden className="text-accent">
                        ●
                    </span>{" "}
                    kanban · tree ops
                </span>
                <ResetButton />
            </div>
            <p className="mt-1.5 text-xs leading-5 text-muted">
                Drag a card between lists — the drop is one{" "}
                <code className="font-mono text-foreground">Retree.move</code>.
                Then watch which render counters moved.
            </p>
            <DndContext
                id="tree-ops-dnd"
                sensors={sensors}
                collisionDetection={pointerWithin}
                onDragEnd={handleDragEnd}
            >
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {COLUMN_KEYS.map((column) => (
                        <BoardColumn key={column} column={column} />
                    ))}
                </div>
                <DragPreview />
            </DndContext>
            <SelectedPanel />
            <div className="mt-auto pt-3">
                <OpLine />
            </div>
        </div>
    );
}

/**
 * The floating copy of whatever is being dragged. Isolated in its own
 * component (via useDndMonitor) so drag start/end state re-renders only
 * this overlay — never the shell, columns, or cards above it.
 */
function DragPreview() {
    const [draggingId, setDraggingId] = useState<number | null>(null);
    useDndMonitor({
        onDragStart: (event) => setDraggingId(Number(event.active.id)),
        onDragEnd: () => setDraggingId(null),
        onDragCancel: () => setDraggingId(null),
    });
    return (
        <DragOverlay>
            {draggingId !== null ? (
                <CardShell dragging>
                    <span
                        aria-hidden
                        className="px-0.5 font-mono text-xs text-faint"
                    >
                        ⋮⋮
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                        {findTask(draggingId)?.task.title}
                    </span>
                </CardShell>
            ) : null}
        </DragOverlay>
    );
}

function ResetButton() {
    return (
        <button
            type="button"
            onClick={resetBoard}
            aria-label="Reset the demo board"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised px-2 py-1 font-mono text-[11px] text-foreground shadow-sm transition-[color,border-color,transform] duration-150 hover:border-[color:var(--accent-glow)] hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97]"
        >
            <span aria-hidden className="text-[9px] text-accent">
                ↺
            </span>
            reset
        </button>
    );
}

/** The op that just ran, as the call it maps to — dogfooded off a tree. */
function OpLine() {
    const log = useNode(opLog);
    return (
        <p className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-faint">
            <span aria-hidden className="shrink-0 text-accent">
                »
            </span>
            <span className="truncate text-muted">
                {log.line === "" ? "// drop a card to run a move" : log.line}
            </span>
        </p>
    );
}

/**
 * Droppable wrapper — deliberately uncounted. dnd-kit re-renders it while
 * a drag hovers (isOver); the memo'd content below only re-renders when
 * the list node actually changes.
 */
function BoardColumn({ column }: { column: ColumnKey }) {
    const { setNodeRef, isOver } = useDroppable({
        id: `column-${column}`,
        data: { column },
    });
    return (
        <div
            ref={setNodeRef}
            className={`rounded-lg border bg-background p-2.5 transition-colors ${
                isOver
                    ? "border-[color:var(--accent-glow)]"
                    : "border-border-token"
            }`}
        >
            <ColumnContent column={column} />
        </div>
    );
}

const ColumnContent = memo(function ColumnContent({
    column,
}: {
    column: ColumnKey;
}) {
    const tasks = useNode(board[column]);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div ref={ref} className="rounded-md">
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-faint">
                    useNode(board.{column})
                </span>
                <BurstRenderBadge renders={renders} />
            </div>
            <ul className="mt-2 min-h-16 space-y-1.5">
                {tasks.map((task, index) => (
                    <BoardCard
                        key={task.id}
                        task={task}
                        column={column}
                        index={index}
                    />
                ))}
                {tasks.length === 0 ? (
                    <li className="rounded-md border border-dashed border-border-strong px-2 py-2 font-mono text-[11px] text-faint">
                        drop a card here
                    </li>
                ) : null}
            </ul>
        </div>
    );
});

/** Shared card frame so the DragOverlay copy matches the real rows. */
function CardShell({
    children,
    dragging = false,
}: {
    children: ReactNode;
    dragging?: boolean;
}) {
    return (
        <div
            className={`flex items-center gap-1.5 rounded-md border bg-surface px-2 py-1.5 ${
                dragging
                    ? "border-[color:var(--accent-glow)] shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
                    : "border-border-token"
            }`}
        >
            {children}
        </div>
    );
}

/**
 * Drag/drop wrapper — deliberately uncounted, like BoardColumn. Only the
 * memo'd content inside carries the badge, so dnd-kit context updates
 * during a drag don't inflate the render evidence.
 */
function BoardCard({
    task,
    column,
    index,
}: {
    task: OpsTask;
    column: ColumnKey;
    index: number;
}) {
    const {
        attributes,
        listeners,
        setNodeRef: setDragRef,
        isDragging,
    } = useDraggable({ id: task.id, data: { column, index } });
    // Cards are drop targets too, so a drop can insert at their position.
    const { setNodeRef: setDropRef } = useDroppable({
        id: `card-${task.id}`,
        data: { column, index },
    });

    // The WHOLE card is the draggable node: the DragOverlay copy is sized
    // from this element's rect, so the full card flies with the pointer
    // (a grip-only ref left the overlay a 14px sliver). The buttons inside
    // still click fine — the sensor needs 4px of travel to start a drag.
    return (
        <li
            ref={(element) => {
                setDragRef(element);
                setDropRef(element);
            }}
            {...listeners}
            {...attributes}
            aria-label={`Drag "${task.title}"`}
            className={`cursor-grab touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:cursor-grabbing ${
                isDragging ? "opacity-35" : ""
            }`}
        >
            <CardShell>
                <span
                    aria-hidden
                    className="px-0.5 font-mono text-xs text-faint"
                >
                    ⋮⋮
                </span>
                <CardContent task={task} />
            </CardShell>
        </li>
    );
}

const CardContent = memo(function CardContent({ task }: { task: OpsTask }) {
    const state = useNode(task);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    const isSelected = useSelect(
        board,
        () => board.selected?.current.id === state.id,
        { listenerType: "nodeChanged" }
    );
    return (
        <div
            ref={ref}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded"
        >
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {state.title}
            </span>
            <BurstRenderBadge renders={renders} />
            <CardButton
                onClick={() => linkTask(state.id)}
                ariaLabel={
                    isSelected
                        ? `Unlink "${state.title}" from board.selected`
                        : `Link "${state.title}" as board.selected`
                }
                active={isSelected}
            >
                ⇢
            </CardButton>
            <CardButton
                onClick={() => cloneTask(state.id)}
                ariaLabel={`Clone "${state.title}"`}
            >
                ⧉
            </CardButton>
            <CardButton
                onClick={() => removeTask(state)}
                ariaLabel={`Delete "${state.title}"`}
                danger
            >
                ✕
            </CardButton>
        </div>
    );
});

function CardButton({
    onClick,
    children,
    ariaLabel,
    danger = false,
    active = false,
}: {
    onClick: () => void;
    children: ReactNode;
    ariaLabel: string;
    danger?: boolean;
    active?: boolean;
}) {
    const tone = danger
        ? "hover:border-[color:var(--danger)] hover:text-danger"
        : "hover:border-[color:var(--accent-glow)] hover:text-accent";
    const activeTone = active
        ? "border-[color:var(--accent-glow)] text-accent"
        : "border-border-strong text-muted";
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            title={ariaLabel}
            className={`inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border bg-surface-raised font-mono text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-95 ${activeTone} ${tone}`}
        >
            {children}
        </button>
    );
}

/**
 * The video's `board.selected` panel: a link is a reactive pointer, not a
 * structural child — drag the linked card to the other list and the link
 * follows it, including which list currently owns it.
 */
function SelectedPanel() {
    const state = useNode(board);
    if (state.selected === null) {
        return (
            <p className="mt-2 rounded-lg border border-dashed border-border-token px-2.5 py-2 font-mono text-[11px] text-faint">
                board.selected = null — press ⇢ on a card to link it
            </p>
        );
    }
    return <SelectedCard link={state.selected} />;
}

function SelectedCard({ link }: { link: RetreeLink<OpsTask> }) {
    const task = useNode(link.current);
    // Where the linked task structurally lives right now — updates as you
    // drag the card between lists, because the link never reparents it.
    const home = useSelect(
        board,
        () => {
            for (const column of COLUMN_KEYS) {
                if (board[column].some((entry) => entry.id === task.id)) {
                    return `board.${column}`;
                }
            }
            return "removed";
        },
        { listenerType: "treeChanged" }
    );
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div
            ref={ref}
            className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-[color:var(--accent-glow)] px-2.5 py-2"
        >
            <span aria-hidden className="font-mono text-xs text-accent">
                ⇢
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                board.selected → {task.title}
                <span className="text-faint"> · lives in {home}</span>
            </span>
            <BurstRenderBadge renders={renders} />
        </div>
    );
}
