"use client";

/**
 * Shared render instrumentation for the comparative visualizer demos.
 *
 * Each demo component calls `useRenderProbe(probe)`, which:
 * 1. counts that component's renders and pulses the react-scan-style glow
 *    (via the site-wide useRenderGlow hook), and
 * 2. mirrors the count into a Retree-managed probe node after each commit so
 *    the schematic tree diagram can display live per-component counters.
 *
 * The instrumentation is identical on both sides of the comparison — it adds
 * exactly one hook call per component and never changes when a component
 * re-renders.
 */

import { useEffect } from "react";
import { Retree } from "@retreejs/core";
import { useSelect } from "@retreejs/react";
import {
    useRenderGlow,
    type RenderGlow,
} from "@/components/visualizer/useRenderGlow";

export interface RenderProbe {
    /** Component label shown in the schematic tree diagram. */
    label: string;
    /** Live render count, mirrored from the component after each commit. */
    renders: number;
}

export interface DemoProbeSet {
    app: RenderProbe;
    name: RenderProbe;
    rows: RenderProbe[];
    done: RenderProbe;
}

/** One probe set per demo implementation; the diagram subscribes per node. */
export function createProbeSet(): DemoProbeSet {
    return Retree.root<DemoProbeSet>({
        app: { label: "TasksApp", renders: 0 },
        name: { label: "NameInput", renders: 0 },
        rows: [
            { label: "TaskRow #1", renders: 0 },
            { label: "TaskRow #2", renders: 0 },
            { label: "TaskRow #3", renders: 0 },
        ],
        done: { label: "DoneCount", renders: 0 },
    });
}

/** Zero every counter (used when the visualizer toggles implementations). */
export function resetProbeSet(probes: DemoProbeSet): void {
    probes.app.renders = 0;
    probes.name.renders = 0;
    for (const row of probes.rows) {
        row.renders = 0;
    }
    probes.done.renders = 0;
}

/**
 * Count this component's renders, pulse the glow on the returned ref's
 * element, and mirror the count into the given probe node after commit.
 */
export function useRenderProbe<T extends HTMLElement>(
    probe: RenderProbe
): RenderGlow<T> {
    const glow = useRenderGlow<T>();
    const { renders } = glow;
    useEffect(() => {
        probe.renders = renders;
    }, [probe, renders]);
    return glow;
}

/**
 * Live sum of every counter in a probe set — the "renders this session"
 * total shown per implementation. Subscribes via useSelect, so it updates
 * whenever any probed component commits.
 */
export function useProbeSetTotal(probes: DemoProbeSet): number {
    return useSelect(
        probes,
        (set) =>
            set.app.renders +
            set.name.renders +
            set.done.renders +
            set.rows.reduce((sum, row) => sum + row.renders, 0),
        { listenerType: "treeChanged" }
    );
}

/* ----------------------- mirrored interactions ----------------------- */

/** The logical interactions the comparison demos support. */
export interface MirrorActions {
    toggleTask(id: number): void;
    setListName(name: string): void;
}

/**
 * Fan-out bus that applies one logical interaction to every registered
 * implementation at once. Both demo apps register their own store's write
 * path and route their local inputs through the bus, so a click or a
 * keystroke in either pane updates BOTH stores — the render counters always
 * compare the exact same interaction, side by side and in real time.
 */
export interface DemoMirror extends MirrorActions {
    /** Register one implementation; returns its unregister function. */
    register(sideId: string, actions: MirrorActions): () => void;
}

export function createDemoMirror(): DemoMirror {
    const sides = new Map<string, MirrorActions>();
    return {
        register(sideId, actions) {
            sides.set(sideId, actions);
            return () => {
                if (sides.get(sideId) === actions) {
                    sides.delete(sideId);
                }
            };
        },
        toggleTask(id) {
            for (const side of sides.values()) {
                side.toggleTask(id);
            }
        },
        setListName(name) {
            for (const side of sides.values()) {
                side.setListName(name);
            }
        },
    };
}
