import {
    H,
    R,
    V,
    resolveFunctionReceiver,
} from "@retreejs/core/compiler-runtime";

// Benchmark-only prototype. Call sites are this.method() for plain methods
// declared in that class. Reflective mutation of managed prototypes is outside
// this probe; a production transform would need a descriptor guard/fallback.
export function prepareMethodCall(self: object, key: string) {
    const handler = Reflect.get(self, H);
    if (handler === undefined || Object.hasOwn(self, key)) {
        return { fn: Reflect.get(self, key), receiver: self };
    }
    const fn = Reflect.get(Reflect.get(self, R), key);
    const receiver = resolveFunctionReceiver(handler, Reflect.get(self, V));
    return { fn, receiver };
}

const apply = Reflect.apply;
export function invokeMethodCall(
    prepared: ReturnType<typeof prepareMethodCall>,
    args: unknown[]
): unknown {
    return apply(prepared.fn, prepared.receiver, args);
}

export { H, R, V, resolveFunctionReceiver };
export const applyMethod = Reflect.apply;
