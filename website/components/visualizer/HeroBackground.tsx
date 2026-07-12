"use client";

/**
 * Decorative hero background: an illustrated tree, drawn with Canvas 2D.
 *
 * A seeded recursive branching algorithm grows a stylized tree rooted at the
 * bottom-right of the hero, its canopy spreading up and to the left behind
 * the content. Three animation systems run on top of the static geometry:
 *
 * 1. WIND — every branch's angle is its parent's live angle plus its own
 *    small oscillation, so sway propagates hierarchically down the tree
 *    (children literally move with their parents — the Retree metaphor).
 *    A slow gust cycle modulates the whole thing; leaves flutter faster.
 * 2. LEAF FALL / REGROWTH — occasionally one leaf detaches, flutters down
 *    with sway and rotation, fades out at the ground line, and later a new
 *    leaf scales back in at the branch tip. Calm cadence, one at a time.
 * 3. WRITE PULSES — every few seconds one random leaf flashes accent green
 *    and a faint highlight traces its branch lineage back to the trunk,
 *    then fades: not everything in a tree is connected, but it can be on
 *    demand.
 *
 * Contract with the page: mounted as the first child of a `relative` hero
 * section, behind `relative z-10` content. It fills its parent absolutely,
 * never intercepts pointer events, and is safe to leave running:
 * - the render loop pauses when the section is off-screen or the tab is
 *   hidden, and stops entirely under prefers-reduced-motion (static tree),
 * - colors come from the site's CSS variables and re-read on theme change
 *   (both the `retree-theme-change` event and prefers-color-scheme),
 * - devicePixelRatio is capped at 2, layout is deterministic (seeded PRNG),
 *   per-frame allocations are near zero, and everything is cleaned up on
 *   unmount.
 *
 * Paint guarantee: the first successful resize() always draws a static frame
 * synchronously (never gated on the rAF loop, IntersectionObserver, or tab
 * visibility). While the container measures 0x0 a bounded rAF chain retries
 * layout, empty theme tokens fall back to literals and re-read until the
 * stylesheet applies, and a one-second watchdog force-draws (and warns) if
 * nothing has painted.
 */

import { useEffect, useRef } from "react";

/* ------------------------------ tuning knobs ------------------------------ */

/** Seed for the deterministic layout PRNG — change to re-art-direct the tree. */
const SEED = 0x7ee5;
/** Levels of branching below the trunk (trunk is depth 0). */
const MAX_DEPTH = 5;
const MAX_BRANCHES = 220;
const MAX_LEAVES = 168;

/** Trunk lean (radians) to the left of vertical. */
const TRUNK_LEAN_RAD = 0.14;
/** Trunk length as a fraction of the scene scale. */
const TRUNK_LENGTH_UNIT = 0.3;
/** Child length ≈ parent length × this (plus jitter). */
const LENGTH_FALLOFF = 0.68;
/** Trunk half-width as a fraction of the scene scale; falls off per depth. */
const WIDTH_TRUNK_UNIT = 0.011;
const WIDTH_FALLOFF = 0.58;
/** Total angular fan of a sibling group at depth 1 (narrows with depth). */
const BRANCH_FAN_RAD = 1.55;
/** Every branch drifts slightly left so the canopy spreads up-left. */
const BRANCH_LEFT_BIAS_RAD = -0.06;
/**
 * Downward-pointing branches keep their hang (it fills the whitespace
 * between the hero columns) but grow shorter: length is scaled down by up
 * to this fraction as a branch's resting angle approaches straight-down.
 * Shortening compounds along a drooping chain, so the low limb dips without
 * scraping the ground line.
 */
const DROOP_LENGTH_SHORTEN = 0.38;

/** Scene scale = min(height × this, width × CANOPY_WIDTH_FRACTION). */
const CANOPY_HEIGHT_FRACTION = 1.02;
const CANOPY_WIDTH_FRACTION = 0.74;

/* Wind. Sway per branch = flex × wind(t) × (gust lean + two oscillators). */
const GUST_FREQ = 0.42;
const GUST_MOD_FREQ = 0.17;
const GUST_MOD_DEPTH = 1.4;
/** Wind never fully dies; floor keeps the tree gently alive between gusts. */
const WIND_FLOOR = 0.25;
const SWAY_FLEX_BASE = 0.024;
const GUST_LEAN = 0.9;
const OSC_PRIMARY = 0.8;
const OSC_SECONDARY = 0.45;
const OSC_FREQ_BASE = 1.0;
const OSC_FREQ_PER_DEPTH = 0.3;
const OSC_FREQ_FAST = 2.7;
const LEAF_FLUTTER_FREQ = 3.1;
const LEAF_FLUTTER_RAD = 0.28;

/* Write pulses ("a write travels leaf → trunk"). */
const PULSE_MIN_GAP_MS = 3200;
const PULSE_GAP_JITTER_MS = 1800;
/** Delay per lineage step as the highlight traces from leaf toward trunk. */
const PULSE_STEP_MS = 70;
const PULSE_BRANCH_DECAY_MS = 620;
const PULSE_LEAF_DECAY_MS = 1350;

/* Falling leaves. */
const FALL_MIN_GAP_MS = 4800;
const FALL_GAP_JITTER_MS = 3400;
/** Vertical fall speed in scene-scale units per second. */
const FALL_SPEED_UNIT = 0.09;
/** Horizontal flutter amplitude while falling (scene units per second). */
const FALL_DRIFT_UNIT = 0.055;
const REGROW_DELAY_MIN_MS = 3800;
const REGROW_DELAY_JITTER_MS = 3200;
const REGROW_MS = 1700;

/* Paint. Opacities are deliberately low — this lives behind hero text. */
const BRANCH_ALPHA_BY_DEPTH = [0.55, 0.5, 0.45, 0.4, 0.36, 0.32];
const LEAF_ALPHAS = [0.5, 0.44, 0.38];
/** Leaf colors mix --muted toward --accent-glow by these fractions. */
const LEAF_ACCENT_MIX = [0.18, 0.42, 0.66];
const GROUND_ALPHA = 0.4;
const MIN_HALF_WIDTH_PX = 0.35;

const FALLBACK_FAINT = "#6e7d75";
const FALLBACK_ACCENT = "#22c55e";
const FALLBACK_ACCENT_SOFT = "rgba(34, 197, 94, 0.35)";
const FALLBACK_BORDER = "#232b27";
/** --muted / --accent-glow fallbacks, pre-parsed for the leaf palette mix. */
const FALLBACK_MUTED_RGB = { r: 163, g: 179, b: 171 } as const;
const FALLBACK_ACCENT_RGB = { r: 34, g: 197, b: 94 } as const;

/* ------------------------------- utilities ------------------------------- */

const TAU = Math.PI * 2;

/** Deterministic PRNG so the tree keeps a stable, art-directed shape. */
function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Rgb {
    r: number;
    g: number;
    b: number;
}

function parseHexColor(hex: string): Rgb | null {
    if (hex.length === 3) {
        const r = Number.parseInt(hex[0] + hex[0], 16);
        const g = Number.parseInt(hex[1] + hex[1], 16);
        const b = Number.parseInt(hex[2] + hex[2], 16);
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
        return { r, g, b };
    }
    if (hex.length === 6) {
        const r = Number.parseInt(hex.slice(0, 2), 16);
        const g = Number.parseInt(hex.slice(2, 4), 16);
        const b = Number.parseInt(hex.slice(4, 6), 16);
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
        return { r, g, b };
    }
    return null;
}

/** Parses `#rgb`, `#rrggbb`, and `rgb()/rgba()` token values. */
function parseColor(value: string): Rgb | null {
    const trimmed = value.trim();
    if (trimmed.startsWith("#")) {
        return parseHexColor(trimmed.slice(1));
    }
    const match = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
    if (match === null) return null;
    const parts = match[1].split(/[,\s/]+/).filter((part) => part !== "");
    if (parts.length < 3) return null;
    const r = Number.parseFloat(parts[0]);
    const g = Number.parseFloat(parts[1]);
    const b = Number.parseFloat(parts[2]);
    if (!Number.isFinite(r)) return null;
    if (!Number.isFinite(g)) return null;
    if (!Number.isFinite(b)) return null;
    return { r, g, b };
}

function mixRgb(from: Rgb, to: Rgb, amount: number): string {
    const r = Math.round(from.r + (to.r - from.r) * amount);
    const g = Math.round(from.g + (to.g - from.g) * amount);
    const b = Math.round(from.b + (to.b - from.b) * amount);
    return `rgb(${r}, ${g}, ${b})`;
}

function readToken(styles: CSSStyleDeclaration, name: string): string {
    return styles.getPropertyValue(name).trim();
}

interface ThemeColors {
    /** Branch/trunk stroke color (from --faint). */
    branch: string;
    /** Write-pulse color (from --accent-glow). */
    accent: string;
    /** Soft glow under a pulsing leaf (from --accent-glow-soft, used as-is). */
    accentSoft: string;
    /** Ground line (from --border). */
    ground: string;
    /** Leaf palette: --muted blended toward --accent-glow. */
    leaves: readonly [string, string, string];
}

interface ThemeColorsRead {
    colors: ThemeColors;
    /**
     * False when any CSS token read back as an empty string — the stylesheet
     * had not applied yet, so `colors` was built from fallback literals and
     * should be re-read once styles land.
     */
    complete: boolean;
}

function readThemeColors(): ThemeColorsRead {
    const styles = getComputedStyle(document.documentElement);
    const faintToken = readToken(styles, "--faint");
    const mutedToken = readToken(styles, "--muted");
    const accentToken = readToken(styles, "--accent-glow");
    const softToken = readToken(styles, "--accent-glow-soft");
    const borderToken = readToken(styles, "--border");

    const complete =
        faintToken !== "" &&
        mutedToken !== "" &&
        accentToken !== "" &&
        softToken !== "" &&
        borderToken !== "";

    const branch = faintToken === "" ? FALLBACK_FAINT : faintToken;
    const accent = accentToken === "" ? FALLBACK_ACCENT : accentToken;
    const accentSoft = softToken === "" ? FALLBACK_ACCENT_SOFT : softToken;
    const ground = borderToken === "" ? FALLBACK_BORDER : borderToken;

    const mutedRgb = parseColor(mutedToken) ?? FALLBACK_MUTED_RGB;
    const accentRgb = parseColor(accent) ?? FALLBACK_ACCENT_RGB;
    const leaves = [
        mixRgb(mutedRgb, accentRgb, LEAF_ACCENT_MIX[0]),
        mixRgb(mutedRgb, accentRgb, LEAF_ACCENT_MIX[1]),
        mixRgb(mutedRgb, accentRgb, LEAF_ACCENT_MIX[2]),
    ] as const;

    return { colors: { branch, accent, accentSoft, ground, leaves }, complete };
}

/* ---------------------------- tree generation ---------------------------- */

interface TreeGeometry {
    branchCount: number;
    /** Parent branch index; -1 for the trunk. */
    parent: Int32Array;
    depth: Uint8Array;
    /** Angle relative to the parent's tip tangent. */
    relAngle: Float32Array;
    /** Lengths/widths in scene-scale units (multiplied by `scale` at draw). */
    length: Float32Array;
    halfWidthBase: Float32Array;
    halfWidthTip: Float32Array;
    /** Curvature: the tip veers this far (radians) off the base angle. */
    bend: Float32Array;
    /** Sway susceptibility — deeper, thinner branches move more. */
    flex: Float32Array;
    phaseA: Float32Array;
    phaseB: Float32Array;

    leafCount: number;
    leafBranch: Int32Array;
    /** Leaf rotation relative to its branch's tip tangent. */
    leafAngle: Float32Array;
    leafOffsetAngle: Float32Array;
    leafOffsetDist: Float32Array;
    leafSize: Float32Array;
    leafPhase: Float32Array;
    leafPalette: Uint8Array;
}

/**
 * How much shorter a branch grows for pointing downward: 1 at horizontal or
 * above, 1 − DROOP_LENGTH_SHORTEN at straight-down. `restAngle` is the
 * branch's windless absolute angle, normalized to (-3π/2, π/2] (up = -π/2).
 */
function droopLengthScale(restAngle: number): number {
    let normalized = restAngle;
    if (normalized > Math.PI / 2) {
        normalized -= TAU;
    } else if (normalized <= (-3 * Math.PI) / 2) {
        normalized += TAU;
    }
    let below: number;
    if (normalized > 0) {
        below = normalized; // dipping on the right side
    } else if (normalized < -Math.PI) {
        below = -Math.PI - normalized; // dipping on the left side
    } else {
        below = 0;
    }
    const downness = Math.min(below / (Math.PI / 2), 1);
    return 1 - DROOP_LENGTH_SHORTEN * downness;
}

function buildTree(): TreeGeometry {
    const random = mulberry32(SEED);
    const parent: number[] = [-1];
    const depth: number[] = [0];
    const relAngle: number[] = [0];
    const length: number[] = [TRUNK_LENGTH_UNIT * (0.95 + random() * 0.1)];
    const bend: number[] = [(random() - 0.5) * 0.12];
    const flex: number[] = [SWAY_FLEX_BASE * 0.35];
    const phaseA: number[] = [random() * TAU];
    const phaseB: number[] = [random() * TAU];
    /** Windless absolute angle per branch, for the droop-shortening rule. */
    const restAngle: number[] = [-Math.PI / 2 - TRUNK_LEAN_RAD];

    // Children are appended after their parent, so index order is always
    // parent-before-child — the per-frame pose pass relies on that.
    for (let i = 0; i < parent.length && parent.length < MAX_BRANCHES; i += 1) {
        const d = depth[i];
        if (d >= MAX_DEPTH) continue;
        let count: number;
        if (d === 0) {
            count = 3;
        } else if (random() < 0.12) {
            count = 1;
        } else {
            count = random() < 0.4 ? 3 : 2;
        }
        const fan = d === 0 ? 1.8 : BRANCH_FAN_RAD - d * 0.14;
        for (let c = 0; c < count && parent.length < MAX_BRANCHES; c += 1) {
            let spread: number;
            if (count === 1) {
                spread = (random() - 0.5) * 0.5;
            } else {
                spread =
                    (c / (count - 1) - 0.5) * fan + (random() - 0.5) * 0.26;
            }
            parent.push(i);
            depth.push(d + 1);
            relAngle.push(spread + BRANCH_LEFT_BIAS_RAD);
            const childRestAngle = restAngle[i] + spread + BRANCH_LEFT_BIAS_RAD;
            restAngle.push(childRestAngle);
            length.push(
                length[i] *
                    (LENGTH_FALLOFF + random() * 0.16) *
                    droopLengthScale(childRestAngle)
            );
            bend.push((random() - 0.5) * 0.55);
            flex.push(
                SWAY_FLEX_BASE * (0.55 + (d + 1) * 0.5) * (0.8 + random() * 0.4)
            );
            phaseA.push(random() * TAU);
            phaseB.push(random() * TAU);
        }
    }

    const branchCount = parent.length;
    const halfWidthBase = new Float32Array(branchCount);
    const halfWidthTip = new Float32Array(branchCount);
    const childCount = new Uint8Array(branchCount);
    for (let i = 0; i < branchCount; i += 1) {
        const base = WIDTH_TRUNK_UNIT * Math.pow(WIDTH_FALLOFF, depth[i]);
        halfWidthBase[i] = base;
        halfWidthTip[i] = base * 0.6;
        if (i > 0) childCount[parent[i]] += 1;
    }

    // Leaf anchors: terminal twigs plus deep interior branches, shuffled so
    // the MAX_LEAVES cap thins the canopy evenly instead of one side.
    const anchors: number[] = [];
    for (let i = 0; i < branchCount; i += 1) {
        const terminal = childCount[i] === 0 && depth[i] >= 2;
        if (terminal || depth[i] >= 4) anchors.push(i);
    }
    for (let i = anchors.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        const swap = anchors[i];
        anchors[i] = anchors[j];
        anchors[j] = swap;
    }

    const leafBranch: number[] = [];
    const leafAngle: number[] = [];
    const leafOffsetAngle: number[] = [];
    const leafOffsetDist: number[] = [];
    const leafSize: number[] = [];
    const leafPhase: number[] = [];
    const leafPalette: number[] = [];
    for (const anchor of anchors) {
        if (leafBranch.length >= MAX_LEAVES) break;
        const cluster = random() < 0.5 ? 3 : 2;
        for (let k = 0; k < cluster && leafBranch.length < MAX_LEAVES; k += 1) {
            leafBranch.push(anchor);
            leafAngle.push((random() - 0.5) * 1.8);
            leafOffsetAngle.push((random() - 0.5) * 2.4);
            leafOffsetDist.push(random() * 0.02);
            leafSize.push(0.018 + random() * 0.012);
            leafPhase.push(random() * TAU);
            leafPalette.push(Math.floor(random() * 3));
        }
    }

    return {
        branchCount,
        parent: Int32Array.from(parent),
        depth: Uint8Array.from(depth),
        relAngle: Float32Array.from(relAngle),
        length: Float32Array.from(length),
        halfWidthBase,
        halfWidthTip,
        bend: Float32Array.from(bend),
        flex: Float32Array.from(flex),
        phaseA: Float32Array.from(phaseA),
        phaseB: Float32Array.from(phaseB),
        leafCount: leafBranch.length,
        leafBranch: Int32Array.from(leafBranch),
        leafAngle: Float32Array.from(leafAngle),
        leafOffsetAngle: Float32Array.from(leafOffsetAngle),
        leafOffsetDist: Float32Array.from(leafOffsetDist),
        leafSize: Float32Array.from(leafSize),
        leafPhase: Float32Array.from(leafPhase),
        leafPalette: Uint8Array.from(leafPalette),
    };
}

/* ------------------------------- rendering ------------------------------- */

/** Quadratic-bezier sample points used to build each tapered branch shape. */
const SAMPLE_T = [0, 1 / 3, 2 / 3, 1] as const;
const SAMPLE_COUNT = SAMPLE_T.length;
const SAMPLE_B0 = SAMPLE_T.map((t) => (1 - t) * (1 - t));
const SAMPLE_B1 = SAMPLE_T.map((t) => 2 * (1 - t) * t);
const SAMPLE_B2 = SAMPLE_T.map((t) => t * t);
const SAMPLE_D0 = SAMPLE_T.map((t) => 2 * (1 - t));
const SAMPLE_D1 = SAMPLE_T.map((t) => 2 * t);

/** Root-flare directions at the trunk base (sign × reach fraction). */
const FLARE_SIDES = [-1, -0.45, 1] as const;

const LEAF_GROWN = 0;
const LEAF_FALLING = 1;
const LEAF_GONE = 2;
const LEAF_REGROWING = 3;

function easeOutCubic(k: number): number {
    const inverted = 1 - k;
    return 1 - inverted * inverted * inverted;
}

/**
 * Builds the scene into `container` and returns a dispose function. Kept
 * outside the component so the effect body stays a thin lifecycle wrapper.
 */
function createScene(container: HTMLElement): () => void {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        // No 2D canvas support — skip the decoration entirely; the hero
        // works without a background.
        return () => undefined;
    }
    ctx.lineCap = "round";
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    const geometry = buildTree();
    const branchCount = geometry.branchCount;
    const leafCount = geometry.leafCount;
    const rand = mulberry32(SEED ^ 0x9e3779b9);
    let colorsRead = readThemeColors();
    let colors = colorsRead.colors;

    // Unit leaf shape pointing +x: base at (0,0), tip at (1,0).
    const leafPath = new Path2D();
    leafPath.moveTo(0, 0);
    leafPath.quadraticCurveTo(0.5, -0.38, 1, 0);
    leafPath.quadraticCurveTo(0.5, 0.38, 0, 0);

    // ---------------------------- pose buffers ----------------------------

    const startX = new Float32Array(branchCount);
    const startY = new Float32Array(branchCount);
    const ctrlX = new Float32Array(branchCount);
    const ctrlY = new Float32Array(branchCount);
    const tipX = new Float32Array(branchCount);
    const tipY = new Float32Array(branchCount);
    const outAngle = new Float32Array(branchCount);
    const polyLX = new Float32Array(SAMPLE_COUNT);
    const polyLY = new Float32Array(SAMPLE_COUNT);
    const polyRX = new Float32Array(SAMPLE_COUNT);
    const polyRY = new Float32Array(SAMPLE_COUNT);

    // ---------------------------- pulse state -----------------------------

    const branchActivation = new Float64Array(branchCount).fill(
        Number.NEGATIVE_INFINITY
    );
    let pulseLeaf = -1;
    let pulseLeafActivation = Number.NEGATIVE_INFINITY;
    let nextPulseAt = performance.now() + 1800;

    // ----------------------------- leaf state -----------------------------

    const leafState = new Uint8Array(leafCount);
    /** FALLING/REGROWING: state start time; GONE: scheduled regrow time. */
    const leafStateTime = new Float64Array(leafCount);
    const fallX = new Float32Array(leafCount);
    const fallY = new Float32Array(leafCount);
    const fallRot = new Float32Array(leafCount);
    const fallRotSpeed = new Float32Array(leafCount);
    const fallDrift = new Float32Array(leafCount);
    let nextFallAt = performance.now() + 5200;

    // ------------------------------- layout -------------------------------

    let width = 0;
    let height = 0;
    let dpr = 1;
    let scale = 1;
    let baseX = 0;
    let baseY = 0;
    let groundY = 0;
    let currentWind = 0;
    /** True once resize() has succeeded — no drawing happens before this. */
    let layoutReady = false;
    /** True once at least one real frame has hit the canvas. */
    let hasPaintedOnce = false;

    const trunkAngle = -Math.PI / 2 - TRUNK_LEAN_RAD;

    // ------------------------------- systems ------------------------------

    const computePose = (t: number, windOn: boolean): void => {
        let wind = 0;
        if (windOn) {
            const gust =
                0.5 +
                0.5 *
                    Math.sin(
                        t * GUST_FREQ +
                            Math.sin(t * GUST_MOD_FREQ) * GUST_MOD_DEPTH
                    );
            wind = WIND_FLOOR + (1 - WIND_FLOOR) * gust;
        }
        currentWind = wind;
        for (let i = 0; i < branchCount; i += 1) {
            const p = geometry.parent[i];
            let originAngle: number;
            let sx: number;
            let sy: number;
            if (p === -1) {
                originAngle = trunkAngle;
                sx = baseX;
                sy = baseY;
            } else {
                originAngle = outAngle[p];
                sx = tipX[p];
                sy = tipY[p];
            }
            let sway = 0;
            if (windOn) {
                const d = geometry.depth[i];
                sway =
                    geometry.flex[i] *
                    wind *
                    (-GUST_LEAN +
                        Math.sin(
                            t * (OSC_FREQ_BASE + d * OSC_FREQ_PER_DEPTH) +
                                geometry.phaseA[i]
                        ) *
                            OSC_PRIMARY +
                        Math.sin(t * OSC_FREQ_FAST + geometry.phaseB[i]) *
                            OSC_SECONDARY);
            }
            const angle = originAngle + geometry.relAngle[i] + sway;
            const len = geometry.length[i] * scale;
            const tipAngle = angle + geometry.bend[i];
            const cx = sx + Math.cos(angle) * len * 0.55;
            const cy = sy + Math.sin(angle) * len * 0.55;
            const ex = sx + Math.cos(tipAngle) * len;
            const ey = sy + Math.sin(tipAngle) * len;
            startX[i] = sx;
            startY[i] = sy;
            ctrlX[i] = cx;
            ctrlY[i] = cy;
            tipX[i] = ex;
            tipY[i] = ey;
            outAngle[i] = Math.atan2(ey - cy, ex - cx);
        }
    };

    const leafAnchorX = (leaf: number): number => {
        const branch = geometry.leafBranch[leaf];
        const angle = outAngle[branch] + geometry.leafOffsetAngle[leaf];
        return (
            tipX[branch] +
            Math.cos(angle) * geometry.leafOffsetDist[leaf] * scale
        );
    };

    const leafAnchorY = (leaf: number): number => {
        const branch = geometry.leafBranch[leaf];
        const angle = outAngle[branch] + geometry.leafOffsetAngle[leaf];
        return (
            tipY[branch] +
            Math.sin(angle) * geometry.leafOffsetDist[leaf] * scale
        );
    };

    const pickGrownLeaf = (): number => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const candidate = Math.floor(rand() * leafCount);
            if (leafState[candidate] === LEAF_GROWN) return candidate;
        }
        return -1;
    };

    const startPulse = (now: number): void => {
        const leaf = pickGrownLeaf();
        if (leaf === -1) return;
        pulseLeaf = leaf;
        pulseLeafActivation = now;
        // The leaf lights first; the highlight then traces its lineage back
        // through parent branches to the trunk.
        let branch = geometry.leafBranch[leaf];
        let step = 0;
        while (branch !== -1) {
            branchActivation[branch] = now + step * PULSE_STEP_MS;
            step += 1;
            branch = geometry.parent[branch];
        }
    };

    const startFall = (now: number): void => {
        const leaf = pickGrownLeaf();
        if (leaf === -1) return;
        // Never drop the leaf that is mid-pulse; it is the signature moment.
        if (leaf === pulseLeaf && now - pulseLeafActivation < 4000) return;
        leafState[leaf] = LEAF_FALLING;
        leafStateTime[leaf] = now;
        fallX[leaf] = leafAnchorX(leaf);
        fallY[leaf] = leafAnchorY(leaf);
        fallRot[leaf] =
            outAngle[geometry.leafBranch[leaf]] + geometry.leafAngle[leaf];
        fallRotSpeed[leaf] = (rand() < 0.5 ? -1 : 1) * (0.8 + rand() * 0.9);
        fallDrift[leaf] = rand() * TAU;
    };

    const updateLeaves = (now: number, t: number, dt: number): void => {
        for (let leaf = 0; leaf < leafCount; leaf += 1) {
            const state = leafState[leaf];
            if (state === LEAF_FALLING) {
                fallY[leaf] +=
                    FALL_SPEED_UNIT *
                    scale *
                    dt *
                    (1 + 0.35 * Math.sin(t * 2.3 + fallDrift[leaf]));
                fallX[leaf] +=
                    (Math.cos(t * 1.7 + fallDrift[leaf]) * FALL_DRIFT_UNIT -
                        0.012 * currentWind) *
                    scale *
                    dt;
                fallRot[leaf] += fallRotSpeed[leaf] * dt;
                if (fallY[leaf] >= groundY - 1) {
                    leafState[leaf] = LEAF_GONE;
                    leafStateTime[leaf] =
                        now +
                        REGROW_DELAY_MIN_MS +
                        rand() * REGROW_DELAY_JITTER_MS;
                }
            } else if (state === LEAF_GONE) {
                if (now >= leafStateTime[leaf]) {
                    leafState[leaf] = LEAF_REGROWING;
                    leafStateTime[leaf] = now;
                }
            } else if (state === LEAF_REGROWING) {
                if (now - leafStateTime[leaf] >= REGROW_MS) {
                    leafState[leaf] = LEAF_GROWN;
                }
            }
        }
    };

    /** Clears pulses and restores every leaf — the calm resting pose. */
    const resetToCalm = (): void => {
        branchActivation.fill(Number.NEGATIVE_INFINITY);
        pulseLeaf = -1;
        pulseLeafActivation = Number.NEGATIVE_INFINITY;
        leafState.fill(LEAF_GROWN);
    };

    // -------------------------------- draw --------------------------------

    const drawGround = (): void => {
        ctx.strokeStyle = colors.ground;
        ctx.globalAlpha = GROUND_ALPHA;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(baseX - scale * 0.6, groundY);
        ctx.lineTo(Math.min(width, baseX + scale * 0.3), groundY);
        ctx.stroke();

        // Root flare at the trunk base.
        ctx.strokeStyle = colors.branch;
        ctx.globalAlpha = BRANCH_ALPHA_BY_DEPTH[0];
        ctx.lineWidth = Math.max(1, WIDTH_TRUNK_UNIT * scale * 0.9);
        for (const side of FLARE_SIDES) {
            ctx.beginPath();
            ctx.moveTo(baseX, baseY - scale * 0.05);
            ctx.quadraticCurveTo(
                baseX + side * scale * 0.012,
                baseY - scale * 0.008,
                baseX + side * scale * 0.05,
                groundY
            );
            ctx.stroke();
        }
    };

    const drawBranches = (): void => {
        ctx.fillStyle = colors.branch;
        for (let i = 0; i < branchCount; i += 1) {
            const sx = startX[i];
            const sy = startY[i];
            const cx = ctrlX[i];
            const cy = ctrlY[i];
            const ex = tipX[i];
            const ey = tipY[i];
            const hwBase = Math.max(
                geometry.halfWidthBase[i] * scale,
                MIN_HALF_WIDTH_PX
            );
            const hwTip = Math.max(
                geometry.halfWidthTip[i] * scale,
                MIN_HALF_WIDTH_PX * 0.8
            );
            for (let k = 0; k < SAMPLE_COUNT; k += 1) {
                const px =
                    SAMPLE_B0[k] * sx + SAMPLE_B1[k] * cx + SAMPLE_B2[k] * ex;
                const py =
                    SAMPLE_B0[k] * sy + SAMPLE_B1[k] * cy + SAMPLE_B2[k] * ey;
                const dx = SAMPLE_D0[k] * (cx - sx) + SAMPLE_D1[k] * (ex - cx);
                const dy = SAMPLE_D0[k] * (cy - sy) + SAMPLE_D1[k] * (ey - cy);
                const inv = 1 / Math.max(Math.hypot(dx, dy), 1e-6);
                const nx = -dy * inv;
                const ny = dx * inv;
                const hw = hwBase + (hwTip - hwBase) * SAMPLE_T[k];
                polyLX[k] = px + nx * hw;
                polyLY[k] = py + ny * hw;
                polyRX[k] = px - nx * hw;
                polyRY[k] = py - ny * hw;
            }
            ctx.globalAlpha = BRANCH_ALPHA_BY_DEPTH[geometry.depth[i]];
            ctx.beginPath();
            ctx.moveTo(polyLX[0], polyLY[0]);
            ctx.lineTo(polyLX[1], polyLY[1]);
            ctx.lineTo(polyLX[2], polyLY[2]);
            ctx.lineTo(polyLX[3], polyLY[3]);
            ctx.lineTo(polyRX[3], polyRY[3]);
            ctx.lineTo(polyRX[2], polyRY[2]);
            ctx.lineTo(polyRX[1], polyRY[1]);
            ctx.lineTo(polyRX[0], polyRY[0]);
            ctx.closePath();
            ctx.fill();
        }
    };

    const drawPulseTrail = (now: number): void => {
        ctx.strokeStyle = colors.accent;
        ctx.lineCap = "round";
        for (let i = 0; i < branchCount; i += 1) {
            const elapsed = now - branchActivation[i];
            if (elapsed < 0) continue;
            const energy = Math.exp(-elapsed / PULSE_BRANCH_DECAY_MS);
            if (energy < 0.02) continue;
            ctx.globalAlpha = energy * 0.5;
            ctx.lineWidth = Math.max(
                1.1,
                geometry.halfWidthTip[i] * scale * 1.8
            );
            ctx.beginPath();
            ctx.moveTo(startX[i], startY[i]);
            ctx.quadraticCurveTo(ctrlX[i], ctrlY[i], tipX[i], tipY[i]);
            ctx.stroke();
        }
    };

    const drawLeaves = (now: number, t: number, windOn: boolean): void => {
        let pulseEnergy = 0;
        const pulseElapsed = now - pulseLeafActivation;
        if (pulseLeaf !== -1 && pulseElapsed >= 0) {
            pulseEnergy = Math.exp(-pulseElapsed / PULSE_LEAF_DECAY_MS);
            if (pulseEnergy < 0.02) pulseEnergy = 0;
        }

        for (let leaf = 0; leaf < leafCount; leaf += 1) {
            const state = leafState[leaf];
            if (state === LEAF_GONE) continue;

            let x: number;
            let y: number;
            let rot: number;
            let sizePx = geometry.leafSize[leaf] * scale;
            const palette = geometry.leafPalette[leaf];
            let alpha = LEAF_ALPHAS[palette];

            if (state === LEAF_FALLING) {
                x = fallX[leaf];
                y = fallY[leaf];
                rot = fallRot[leaf];
                const fadeZone = scale * 0.12;
                const remaining = (groundY - y) / fadeZone;
                alpha *= Math.min(Math.max(remaining, 0), 1);
            } else {
                x = leafAnchorX(leaf);
                y = leafAnchorY(leaf);
                rot =
                    outAngle[geometry.leafBranch[leaf]] +
                    geometry.leafAngle[leaf];
                if (windOn) {
                    rot +=
                        Math.sin(
                            t * LEAF_FLUTTER_FREQ + geometry.leafPhase[leaf]
                        ) *
                        LEAF_FLUTTER_RAD *
                        currentWind;
                }
                if (state === LEAF_REGROWING) {
                    const progress = Math.min(
                        (now - leafStateTime[leaf]) / REGROW_MS,
                        1
                    );
                    const eased = easeOutCubic(progress);
                    sizePx *= eased;
                    alpha *= eased;
                }
            }
            if (alpha <= 0.01) continue;
            if (sizePx <= 0.1) continue;

            const isPulsing = leaf === pulseLeaf && pulseEnergy > 0;
            if (isPulsing) {
                // Soft accent glow beneath the pulsing leaf ("the write").
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.fillStyle = colors.accentSoft;
                ctx.globalAlpha = pulseEnergy;
                ctx.beginPath();
                ctx.arc(x, y, sizePx * 2.4, 0, TAU);
                ctx.fill();
            }

            const cosR = Math.cos(rot) * sizePx * dpr;
            const sinR = Math.sin(rot) * sizePx * dpr;
            ctx.setTransform(cosR, sinR, -sinR, cosR, x * dpr, y * dpr);
            ctx.fillStyle = colors.leaves[palette];
            ctx.globalAlpha = alpha;
            ctx.fill(leafPath);
            if (isPulsing) {
                ctx.fillStyle = colors.accent;
                ctx.globalAlpha = pulseEnergy;
                ctx.fill(leafPath);
            }
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number, t: number, windOn: boolean): void => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        drawGround();
        drawBranches();
        drawPulseTrail(now);
        drawLeaves(now, t, windOn);
        ctx.globalAlpha = 1;
        hasPaintedOnce = true;
    };

    // ----------------------------- render loop ----------------------------

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    let reducedMotion = motionQuery.matches;
    let inView = true;
    let running = false;
    let frameId = 0;
    let lastFrameAt = performance.now();

    const renderFrame = (): void => {
        if (!layoutReady) return;
        const now = performance.now();
        const t = now / 1000;
        const dt = Math.min(Math.max((now - lastFrameAt) / 1000, 0), 0.05);
        lastFrameAt = now;

        computePose(t, true);
        if (now >= nextPulseAt) {
            startPulse(now);
            nextPulseAt = now + PULSE_MIN_GAP_MS + rand() * PULSE_GAP_JITTER_MS;
        }
        if (now >= nextFallAt) {
            startFall(now);
            nextFallAt = now + FALL_MIN_GAP_MS + rand() * FALL_GAP_JITTER_MS;
        }
        updateLeaves(now, t, dt);
        draw(now, t, true);
    };

    /** One windless, pulse-free frame — the reduced-motion / paused pose. */
    const renderStatic = (): void => {
        if (!layoutReady) return;
        computePose(0, false);
        draw(0, 0, false);
    };

    const renderStaticIfPaused = (): void => {
        if (!running) renderStatic();
    };

    const loop = (): void => {
        if (!running) return;
        renderFrame();
        frameId = requestAnimationFrame(loop);
    };

    const updateRunning = (): void => {
        const shouldRun = inView && !document.hidden && !reducedMotion;
        if (shouldRun === running) return;
        running = shouldRun;
        if (running) {
            lastFrameAt = performance.now();
            frameId = requestAnimationFrame(loop);
        } else {
            cancelAnimationFrame(frameId);
        }
    };

    // ------------------------------ listeners -----------------------------

    const resize = (): void => {
        const nextWidth = container.clientWidth;
        const nextHeight = container.clientHeight;
        if (nextWidth === 0) return;
        if (nextHeight === 0) return;
        width = nextWidth;
        height = nextHeight;
        dpr = Math.min(window.devicePixelRatio, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        scale = Math.min(
            height * CANOPY_HEIGHT_FRACTION,
            width * CANOPY_WIDTH_FRACTION
        );
        scale = Math.min(Math.max(scale, 220), 1150);
        groundY = height - Math.min(24, height * 0.05);
        baseX = Math.min(width * 0.8, width - scale * 0.22);
        baseY = groundY;
        const firstLayout = !layoutReady;
        layoutReady = true;
        if (firstLayout) {
            // First successful layout paints synchronously no matter what:
            // the rAF loop may be throttled to zero (hidden/occluded tab),
            // so waiting for it can leave the canvas blank indefinitely.
            renderStatic();
            return;
        }
        renderStaticIfPaused();
    };

    // Kick layout now, then keep retrying by animation frame while the
    // container measures 0x0 (pre-layout, streaming CSS, fonts settling).
    // The ResizeObserver below is the primary recovery path; this bounded
    // chain covers the case where its initial 0x0 report is never followed
    // by another delivery.
    let layoutRetryId = 0;
    let layoutRetriesLeft = 150;
    const retryLayoutUntilSized = (): void => {
        if (!layoutReady) resize();
        if (layoutReady) return;
        if (layoutRetriesLeft <= 0) {
            console.warn(
                "HeroBackground: hero container still measures 0x0 after 150 animation-frame retries; the background tree cannot draw until ResizeObserver reports a non-zero size."
            );
            return;
        }
        layoutRetriesLeft -= 1;
        layoutRetryId = requestAnimationFrame(retryLayoutUntilSized);
    };
    retryLayoutUntilSized();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const intersectionObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            inView = entry.isIntersecting;
        }
        updateRunning();
    });
    intersectionObserver.observe(container);

    const onVisibilityChange = (): void => updateRunning();
    document.addEventListener("visibilitychange", onVisibilityChange);

    const onMotionChange = (): void => {
        reducedMotion = motionQuery.matches;
        if (reducedMotion) {
            resetToCalm();
        } else {
            const now = performance.now();
            nextPulseAt = now + 1500;
            nextFallAt = now + 5200;
        }
        updateRunning();
        renderStaticIfPaused();
    };
    motionQuery.addEventListener("change", onMotionChange);

    const onThemeChange = (): void => {
        colorsRead = readThemeColors();
        colors = colorsRead.colors;
        renderStaticIfPaused();
    };
    window.addEventListener("retree-theme-change", onThemeChange);
    schemeQuery.addEventListener("change", onThemeChange);

    // If the mount-time read caught the stylesheet before it applied (tokens
    // empty, fallback literals in use), re-read on subsequent frames until
    // the real theme values land.
    let colorRetryId = 0;
    let colorRetriesLeft = 60;
    const retryColorsUntilComplete = (): void => {
        if (colorsRead.complete) return;
        colorsRead = readThemeColors();
        colors = colorsRead.colors;
        if (colorsRead.complete) {
            renderStaticIfPaused();
            return;
        }
        if (colorRetriesLeft <= 0) {
            console.warn(
                "HeroBackground: theme tokens (--faint, --muted, --accent-glow, --accent-glow-soft, --border) still read empty after 60 animation-frame retries; the background tree keeps its fallback colors."
            );
            return;
        }
        colorRetriesLeft -= 1;
        colorRetryId = requestAnimationFrame(retryColorsUntilComplete);
    };
    retryColorsUntilComplete();

    // bfcache restore: visibilitychange fires too, but pageshow is the
    // dedicated signal — resume the loop and make sure a frame exists.
    const onPageShow = (): void => {
        updateRunning();
        renderStaticIfPaused();
    };
    window.addEventListener("pageshow", onPageShow);

    // First paint: reduced-motion users keep the static tree from resize();
    // everyone else starts the loop.
    if (reducedMotion) {
        onMotionChange();
    }
    updateRunning();

    // Belt and braces: if nothing has painted ~1s after mount, one of the
    // guards above failed — name it and force a frame.
    const watchdogId = window.setTimeout(() => {
        if (hasPaintedOnce) return;
        if (!layoutReady) {
            console.warn(
                "HeroBackground: no frame painted within 1s of mount because the container never reached a non-zero size; forcing a relayout now."
            );
            resize();
            return;
        }
        console.warn(
            "HeroBackground: no frame painted within 1s of mount despite a sized container; forcing a static draw now."
        );
        renderStatic();
    }, 1000);

    return () => {
        running = false;
        cancelAnimationFrame(frameId);
        cancelAnimationFrame(layoutRetryId);
        cancelAnimationFrame(colorRetryId);
        window.clearTimeout(watchdogId);
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        document.removeEventListener("visibilitychange", onVisibilityChange);
        motionQuery.removeEventListener("change", onMotionChange);
        schemeQuery.removeEventListener("change", onThemeChange);
        window.removeEventListener("retree-theme-change", onThemeChange);
        window.removeEventListener("pageshow", onPageShow);
        canvas.remove();
    };
}

export function HeroBackground() {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (container === null) return;
        const dispose = createScene(container);
        return dispose;
    }, []);

    return (
        <div
            ref={containerRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden opacity-70 [mask-image:radial-gradient(140%_130%_at_70%_52%,black_55%,transparent_99%)]"
        />
    );
}
