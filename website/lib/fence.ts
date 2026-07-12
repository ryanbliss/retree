import { Children, isValidElement, type ReactNode } from "react";

export interface FenceMeta {
    [key: string]: string | boolean;
}

export interface Fence {
    code: string;
    lang: string;
    meta: FenceMeta;
}

/** Parses a fence meta string like `title="App.tsx" live height=420`. */
export function parseFenceMeta(meta: string | undefined): FenceMeta {
    const result: FenceMeta = {};
    if (!meta) return result;
    const pattern = /([\w-]+)(?:=(?:"([^"]*)"|([^\s"]+)))?/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(meta)) !== null) {
        const [, key, quoted, bare] = match;
        result[key] = quoted ?? bare ?? true;
    }
    return result;
}

/** Reads a fenced-code <code> element's props into a Fence, if it is one. */
function readFence(props: Record<string, unknown>): Fence | undefined {
    if (typeof props.children !== "string") return undefined;
    if (typeof props.className !== "string") return undefined;
    const lang =
        props.className
            .split(" ")
            .find((name) => name.startsWith("language-"))
            ?.replace("language-", "") ?? "ts";
    return {
        code: props.children,
        lang,
        meta: parseFenceMeta(
            typeof props.metastring === "string" ? props.metastring : undefined
        ),
    };
}

/**
 * Extracts fenced code blocks from MDX-rendered children. Handles raw
 * <pre><code> structures so MDX wrapper components (like Sandbox) can consume
 * the fences written inside them as plain markdown.
 */
export function extractFences(children: ReactNode): Fence[] {
    const fences: Fence[] = [];
    walk(children, fences);
    return fences;
}

function walk(node: ReactNode, fences: Fence[]) {
    Children.forEach(node, (child) => {
        if (!isValidElement(child)) return;
        const props = child.props as Record<string, unknown>;
        const fence = readFence(props);
        if (fence !== undefined) {
            fences.push(fence);
            return;
        }
        if (props.children !== undefined) {
            walk(props.children as ReactNode, fences);
        }
    });
}
