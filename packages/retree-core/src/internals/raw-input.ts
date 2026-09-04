import {
    ReactiveNode,
    COLLECTED_KEYS_SYMBOL,
    LINKED_KEYS_SYMBOL,
} from "../ReactiveNode.js";
import {
    getCustomProxyHandlerFromMetadata,
    unproxiedBaseNodeKey,
} from "./proxy-types.js";
import { getManagedProxyForUnproxiedNode } from "./reproxy.js";

const normalizedInputs = new WeakSet<object>();
const inputsWithManagedChildren = new WeakSet<object>();

export function inputNeedsMaterialization(value: object): boolean {
    return (
        inputsWithManagedChildren.has(value) ||
        getManagedProxyForUnproxiedNode(value) !== undefined
    );
}

/** Normalize each new input once; proxy creation can still remain lazy. */
export function normalizeRawInput<T extends object>(input: T): T {
    if (normalizedInputs.has(input)) return input;
    const active = new Set<object>();
    const completed: object[] = [];
    const pending: { node: object; parent?: object; exit: boolean }[] = [
        { node: input, exit: false },
    ];
    try {
        while (pending.length > 0) {
            const entry = pending.pop()!;
            const { node, parent } = entry;
            if (entry.exit) {
                active.delete(node);
                normalizedInputs.add(node);
                completed.push(node);
                if (parent !== undefined && inputsWithManagedChildren.has(node))
                    inputsWithManagedChildren.add(parent);
                continue;
            }
            if (active.has(node))
                throw new Error(
                    "Retree cannot own a structural cycle. Use Retree.link or @link for a back-reference."
                );
            if (normalizedInputs.has(node)) {
                if (parent !== undefined && inputNeedsMaterialization(node))
                    inputsWithManagedChildren.add(parent);
                continue;
            }
            active.add(node);
            pending.push({ ...entry, exit: true });
            const visit = (value: unknown): unknown => {
                if (value === null || typeof value !== "object") return value;
                const handler = getCustomProxyHandlerFromMetadata(value);
                const raw = handler?.[unproxiedBaseNodeKey] ?? value;
                const managed =
                    handler ??
                    getCustomProxyHandlerFromMetadata(
                        getManagedProxyForUnproxiedNode(raw)
                    );
                if (managed !== undefined) inputsWithManagedChildren.add(node);
                pending.push({ node: raw, parent: node, exit: false });
                return raw;
            };
            if (node instanceof Map) {
                for (const [key, value] of node) {
                    const raw = visit(value);
                    if (raw !== value) node.set(key, raw);
                }
            } else if (node instanceof Set) {
                const values = [...node];
                const rawValues = values.map(visit);
                if (values.some((value, index) => value !== rawValues[index])) {
                    node.clear();
                    for (const value of rawValues) node.add(value);
                }
            } else {
                const reactive =
                    node instanceof ReactiveNode ? node : undefined;
                for (const key of Reflect.ownKeys(node)) {
                    if (typeof key === "string" && key.startsWith("RETREE_"))
                        continue;
                    if (reactive?.[COLLECTED_KEYS_SYMBOL].has(key)) continue;
                    if (reactive?.[LINKED_KEYS_SYMBOL].has(key)) continue;
                    const descriptor = Reflect.getOwnPropertyDescriptor(
                        node,
                        key
                    );
                    if (descriptor === undefined || !("value" in descriptor))
                        continue;
                    const raw = visit(descriptor.value);
                    if (
                        raw !== descriptor.value &&
                        !Reflect.defineProperty(node, key, {
                            ...descriptor,
                            value: raw,
                        })
                    ) {
                        throw new Error(
                            `Retree cannot normalize the proxy stored in locked property '${String(
                                key
                            )}'. Store its raw value before locking the property.`
                        );
                    }
                }
            }
        }
    } catch (error) {
        for (const node of completed) normalizedInputs.delete(node);
        throw error;
    }
    return input;
}
