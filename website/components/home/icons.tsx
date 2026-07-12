import type { ReactNode } from "react";

/**
 * The home page's icon set — one consistent family matching the TreeMark
 * logo in components/site/SiteNav.tsx: 24px viewBox, stroke-based,
 * strokeWidth 2, round caps/joins, `currentColor` so token classes
 * (text-accent / text-muted / text-faint) color them in both themes.
 *
 * Icons are decorative support for adjacent text: render them small
 * (13–18px via `size`), always with `aria-hidden` (applied here), never
 * as the only carrier of meaning.
 */

export interface IconProps {
    /** Rendered width/height in px. Defaults to 16. */
    size?: number;
    className?: string;
}

function Icon({
    size = 16,
    className,
    children,
}: IconProps & { children: ReactNode }) {
    return (
        <svg
            aria-hidden
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            {children}
        </svg>
    );
}

/** Plain-assignment mutation — a pencil. */
export function PencilIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M21.2 6.8a2.83 2.83 0 0 0-4-4L3.5 16.5 3 21l4.5-.5Z" />
            <path d="m14.5 5.5 4 4" />
        </Icon>
    );
}

/** Per-node subscriptions / events — a radio signal. */
export function SignalIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="12" r="1.6" />
            <path d="M8.46 8.46a5 5 0 0 0 0 7.08" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.08" />
            <path d="M5.64 5.64a9 9 0 0 0 0 12.72" />
            <path d="M18.36 5.64a9 9 0 0 1 0 12.72" />
        </Icon>
    );
}

/** The state tree — same geometry as the site logo's TreeMark. */
export function TreeIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="5" r="2.2" />
            <circle cx="6" cy="19" r="2.2" />
            <circle cx="18" cy="19" r="2.2" />
            <path d="M12 7.5v4m0 0-4.8 5.6M12 11.5l4.8 5.6" />
        </Icon>
    );
}

/** Tree operations (move / link / clone) — a branch. */
export function BranchIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="6" cy="6" r="2.2" />
            <circle cx="6" cy="18" r="2.2" />
            <circle cx="18" cy="6" r="2.2" />
            <path d="M6 8.2v7.6" />
            <path d="M18 8.2a9.8 9.8 0 0 1-9.8 9.8" />
        </Icon>
    );
}

/** Decorators on class view models — an at-sign. */
export function AtSignIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="12" r="3.6" />
            <path d="M15.6 12v1.7a2.2 2.2 0 0 0 4.4 0V12a8 8 0 1 0-3.1 6.3" />
        </Icon>
    );
}

/** Selective derivation (useSelect) — a target. */
export function TargetIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="12" r="8.5" />
            <circle cx="12" cy="12" r="3.5" />
        </Icon>
    );
}

/** A published package — a parcel box. */
export function PackageIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M21 8.2a2 2 0 0 0-1-1.74l-7-4.02a2 2 0 0 0-2 0l-7 4.02A2 2 0 0 0 3 8.2v7.6a2 2 0 0 0 1 1.74l7 4.02a2 2 0 0 0 2 0l7-4.02a2 2 0 0 0 1-1.74Z" />
            <path d="M3.3 7.3 12 12.3l8.7-5" />
            <path d="M12 22v-9.7" />
        </Icon>
    );
}

/** Performance — a gauge. */
export function GaugeIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="m12 14 3.5-3.5" />
            <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </Icon>
    );
}

/** Integrations (Convex) — a plug. */
export function PlugIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M9 7V3" />
            <path d="M15 7V3" />
            <path d="M7 7h10l-.8 4.6a4.3 4.3 0 0 1-8.4 0Z" />
            <path d="M12 16.4V21" />
        </Icon>
    );
}

/** Guides and docs — an open book. */
export function BookIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M12 6.8C10.4 5.3 8.4 4.8 6 4.8c-1.1 0-2.1.15-3 .45V18.9c.9-.3 1.9-.45 3-.45 2.4 0 4.4.55 6 2 1.6-1.45 3.6-2 6-2 1.1 0 2.1.15 3 .45V5.25c-.9-.3-1.9-.45-3-.45-2.4 0-4.4.5-6 2Z" />
            <path d="M12 6.8v13.6" />
        </Icon>
    );
}

/** AI agents / CLI — a terminal prompt. */
export function TerminalIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="m5 7 5 5-5 5" />
            <path d="M12.5 17H19" />
        </Icon>
    );
}

/** Raw-speed escape hatches — a bolt. */
export function BoltIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M13 2.5 4.5 13.5h6L11 21.5l8.5-11h-6Z" />
        </Icon>
    );
}

/** Transactions / batching — stacked layers. */
export function LayersIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="m12 3.5 8.5 4.7L12 12.9 3.5 8.2Z" />
            <path d="m3.5 13.4 8.5 4.7 8.5-4.7" />
        </Icon>
    );
}

/** Side-by-side comparison — two columns. */
export function ColumnsIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <rect x="3" y="4.5" width="7.6" height="15" rx="1.6" />
            <rect x="13.4" y="4.5" width="7.6" height="15" rx="1.6" />
        </Icon>
    );
}

/** Forward navigation — an arrow. */
export function ArrowRightIcon(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M4.5 12h15" />
            <path d="m13.5 6 6 6-6 6" />
        </Icon>
    );
}
