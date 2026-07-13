"use client";

import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";
import { motion, useReducedMotion } from "motion/react";
import { BurstRenderBadge } from "@/components/visualizer/BurstRenderBadge";
import { useRenderGlow } from "@/components/visualizer/useRenderGlow";
import {
    AutoplayStatusLine,
    createAutoplaySession,
    createTypingBurst,
    takeOver,
    useScriptedAutoplay,
} from "@/components/visualizer/scriptedAutoplay";

interface StickyNote {
    sticker: string;
    text: string;
}

function initialNotes(): StickyNote[] {
    return [
        { sticker: "📌", text: "Buy oat milk" },
        { sticker: "⭐", text: "Call Dana" },
        { sticker: "🌱", text: "Water plants" },
        { sticker: "✈️", text: "Book flights" },
    ];
}

/** Real Retree tree backing feature demo 1 — each sticky is its own node. */
const board = Retree.root<{ notes: StickyNote[] }>({ notes: initialNotes() });

/* Presentation only (tint + a paper-ish rotation per note) — kept out of
 * the tree so writes map one-to-one onto what the code block shows. */
const STICKY_LOOKS = [
    { rgb: "230, 192, 123", rotate: -1.6 },
    { rgb: "124, 216, 255", rotate: 1.3 },
    { rgb: "95, 224, 141", rotate: -1.1 },
    { rgb: "163, 179, 171", rotate: 1.7 },
];

/** Tapping a sticker cycles it — note 3's seedling grows into a tree. */
const STICKER_CYCLES: string[][] = [
    ["📌", "📎", "🔖"],
    ["⭐", "🌟", "💫"],
    ["🌱", "🌳"],
    ["✈️", "🗺️", "🏝️"],
];

function cycleSticker(index: number): void {
    const note = board.notes[index];
    const cycle = STICKER_CYCLES[index];
    const at = cycle.indexOf(note.sticker);
    note.sticker = cycle[(at + 1) % cycle.length];
}

/* ---------------------------- scripted loop ----------------------------
 * Hero convention: scripted writes replay the video's beat (edit note 3's
 * text, then grow its seedling into a tree) until the user takes over by
 * typing in a note or tapping a sticker.
 */

const autoplaySession = createAutoplaySession();

let burstNoteIndex = 2;

/** Simulated keystrokes — every intermediate value is a real write. */
const textBurst = createTypingBurst({
    read: () => board.notes[burstNoteIndex].text,
    write: (value) => {
        board.notes[burstNoteIndex].text = value;
        autoplaySession.lastLine = `notes[${burstNoteIndex}].text = ${JSON.stringify(
            value
        )}`;
    },
    shouldContinue: () =>
        autoplaySession.mode === "auto" || autoplaySession.mode === "done",
    charMs: 160,
});

type AutoplayAction =
    | { kind: "text"; note: number; value: string }
    | { kind: "sticker"; note: number };

/** The video's sequence first (same note: text, then sticker), then variety. */
const AUTOPLAY_ACTIONS: AutoplayAction[] = [
    { kind: "text", note: 2, value: "Plant a tree" },
    { kind: "sticker", note: 2 },
    { kind: "text", note: 0, value: "Refill oat milk" },
    { kind: "sticker", note: 1 },
    { kind: "text", note: 3, value: "Book the offsite" },
    { kind: "sticker", note: 3 },
];

let autoplayStep = 0;

function runAutoplayStep(): boolean | void {
    // Let an in-flight retype be the only activity on screen.
    if (textBurst.isActive()) return false;
    const action = AUTOPLAY_ACTIONS[autoplayStep % AUTOPLAY_ACTIONS.length];
    autoplayStep += 1;
    if (action.kind === "text") {
        burstNoteIndex = action.note;
        textBurst.start(action.value);
        return;
    }
    cycleSticker(action.note);
    autoplaySession.lastLine = `notes[${
        action.note
    }].sticker = ${JSON.stringify(board.notes[action.note].sticker)}`;
}

function userSetText(index: number, value: string): void {
    textBurst.cancel();
    takeOver(
        autoplaySession,
        `notes[${index}].text = ${JSON.stringify(value)}`
    );
    board.notes[index].text = value;
}

function userCycleSticker(index: number): void {
    textBurst.cancel();
    cycleSticker(index);
    takeOver(
        autoplaySession,
        `notes[${index}].sticker = ${JSON.stringify(
            board.notes[index].sticker
        )}`
    );
}

/** Unmount cleanup: back-navigation must start from a clean slate. */
function handleStickyUnmount(): void {
    textBurst.cancel();
    autoplayStep = 0;
    burstNoteIndex = 2;
    board.notes.splice(0, board.notes.length, ...initialNotes());
}

/**
 * Feature-walk demo 1 (the video's sticky board): four sticky notes, each
 * subscribed to its own node via useNode. Editing a note's text or tapping
 * its sticker re-renders that sticky only — the render badge inside each
 * note is the evidence.
 */
export function StickyBoardDemo() {
    const pauseHandlers = useScriptedAutoplay({
        session: autoplaySession,
        intervalMs: 3200,
        initialDelayMs: 1200,
        step: runAutoplayStep,
        maxSteps: 14,
        onUnmount: handleStickyUnmount,
    });
    return (
        <div
            {...pauseHandlers}
            className="flex h-full flex-col rounded-xl border border-border-token bg-surface p-3 shadow-[var(--glass-shadow)] sm:p-4"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-faint">
                    <span aria-hidden className="text-accent">
                        ●
                    </span>{" "}
                    sticky board · live
                </span>
                <span className="rounded border border-border-token px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                    {board.notes.length} notes
                </span>
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {board.notes.map((note, index) => (
                    <Sticky key={index} note={note} index={index} />
                ))}
            </div>
            <p className="mt-3 text-xs text-muted">
                Writes fire on their own — edit a note or tap a sticker to take
                over. Only that note&apos;s counter moves.
            </p>
            <div className="mt-auto pt-3">
                <AutoplayStatusLine
                    session={autoplaySession}
                    idleLine="// scripted writes start in a moment"
                />
            </div>
        </div>
    );
}

function Sticky({ note, index }: { note: StickyNote; index: number }) {
    // Subscribes to this note only — the whole point of the demo.
    const state = useNode(note);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    const reduceMotion = useReducedMotion();
    const look = STICKY_LOOKS[index];
    return (
        <div
            ref={ref}
            className="relative flex min-h-32 flex-col rounded-xl p-3"
            style={{
                background: `rgba(${look.rgb}, 0.14)`,
                border: `1px solid rgba(${look.rgb}, 0.45)`,
                transform: `rotate(${look.rotate}deg)`,
            }}
        >
            <button
                type="button"
                onClick={() => userCycleSticker(index)}
                aria-label={`Change the sticker on note ${index + 1}`}
                className="self-start rounded-md text-2xl leading-none transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-90"
            >
                <motion.span
                    key={state.sticker}
                    initial={reduceMotion ? false : { scale: 0.35 }}
                    animate={{ scale: 1 }}
                    transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 16,
                    }}
                    className="inline-block"
                >
                    {state.sticker}
                </motion.span>
            </button>
            <input
                value={state.text}
                onChange={(event) => userSetText(index, event.target.value)}
                aria-label={`Edit the text of note ${index + 1}`}
                className="mt-2 w-full bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-faint"
            />
            <div className="mt-auto flex justify-end pt-2">
                <BurstRenderBadge renders={renders} />
            </div>
        </div>
    );
}
