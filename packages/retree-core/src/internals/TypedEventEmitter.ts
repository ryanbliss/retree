/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 *
 * Credit: https://github.com/microsoft/FluidFramework
 */

/**
 * The event emitter polyfill and the node event emitter have different event types:
 * string | symbol vs. string | number
 *
 * The polyfill is now always used, but string is the only event type preferred.
 * @legacy
 * @alpha
 */
export type EventEmitterEventType = string;

/**
 * Base interface for event emitters.
 * @public
 */
export interface IEvent {
    /**
     * Base event emitter signature.
     *
     * @remarks The event emitter polyfill and the node event emitter have different event types:
     * `string | symbol` vs. `string | number`.
     *
     * So for our typing we'll contrain to string, that way we work with both.
     *
     * @eventProperty
     */
    // @ts-ignore
    (event: string, listener: (...args: any[]) => void);
}

/**
 * The placeholder type that should be used instead of `this` in events.
 * @public
 */
export type IEventThisPlaceHolder = { thisPlaceHolder: "thisPlaceHolder" };

/**
 * Does the type replacement by changing types of {@link IEventThisPlaceHolder} to `TThis`
 * @public
 */
export type ReplaceIEventThisPlaceHolder<
    L extends any[],
    TThis
> = L extends any[]
    ? { [K in keyof L]: L[K] extends IEventThisPlaceHolder ? TThis : L[K] }
    : L;

/**
 * Transforms the event overload by replacing {@link IEventThisPlaceHolder} with `TThis` in the event listener
 * arguments and having the overload return `TTHis` as well
 * @public
 */
export type TransformedEvent<TThis, E, A extends any[]> = (
    event: E,
    listener: (...args: ReplaceIEventThisPlaceHolder<A, TThis>) => void
) => TThis;

// @public
export type IEventTransformer<TThis, TEvent extends IEvent> = TEvent extends {
    (event: infer E0, listener: (...args: infer A0) => void): any;
    (event: infer E1, listener: (...args: infer A1) => void): any;
    (event: infer E2, listener: (...args: infer A2) => void): any;
    (event: infer E3, listener: (...args: infer A3) => void): any;
    (event: infer E4, listener: (...args: infer A4) => void): any;
    (event: infer E5, listener: (...args: infer A5) => void): any;
    (event: infer E6, listener: (...args: infer A6) => void): any;
    (event: infer E7, listener: (...args: infer A7) => void): any;
    (event: infer E8, listener: (...args: infer A8) => void): any;
    (event: infer E9, listener: (...args: infer A9) => void): any;
    (event: infer E10, listener: (...args: infer A10) => void): any;
    (event: infer E11, listener: (...args: infer A11) => void): any;
    (event: infer E12, listener: (...args: infer A12) => void): any;
    (event: infer E13, listener: (...args: infer A13) => void): any;
    (event: infer E14, listener: (...args: infer A14) => void): any;
    (event: string, listener: (...args: any[]) => void): any;
}
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4> &
          TransformedEvent<TThis, E5, A5> &
          TransformedEvent<TThis, E6, A6> &
          TransformedEvent<TThis, E7, A7> &
          TransformedEvent<TThis, E8, A8> &
          TransformedEvent<TThis, E9, A9> &
          TransformedEvent<TThis, E10, A10> &
          TransformedEvent<TThis, E11, A11> &
          TransformedEvent<TThis, E12, A12> &
          TransformedEvent<TThis, E13, A13> &
          TransformedEvent<TThis, E14, A14>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: infer E4, listener: (...args: infer A4) => void): any;
          (event: infer E5, listener: (...args: infer A5) => void): any;
          (event: infer E6, listener: (...args: infer A6) => void): any;
          (event: infer E7, listener: (...args: infer A7) => void): any;
          (event: infer E8, listener: (...args: infer A8) => void): any;
          (event: infer E9, listener: (...args: infer A9) => void): any;
          (event: infer E10, listener: (...args: infer A10) => void): any;
          (event: infer E11, listener: (...args: infer A11) => void): any;
          (event: infer E12, listener: (...args: infer A12) => void): any;
          (event: infer E13, listener: (...args: infer A13) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4> &
          TransformedEvent<TThis, E5, A5> &
          TransformedEvent<TThis, E6, A6> &
          TransformedEvent<TThis, E7, A7> &
          TransformedEvent<TThis, E8, A8> &
          TransformedEvent<TThis, E9, A9> &
          TransformedEvent<TThis, E10, A10> &
          TransformedEvent<TThis, E11, A11> &
          TransformedEvent<TThis, E12, A12> &
          TransformedEvent<TThis, E13, A13>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: infer E4, listener: (...args: infer A4) => void): any;
          (event: infer E5, listener: (...args: infer A5) => void): any;
          (event: infer E6, listener: (...args: infer A6) => void): any;
          (event: infer E7, listener: (...args: infer A7) => void): any;
          (event: infer E8, listener: (...args: infer A8) => void): any;
          (event: infer E9, listener: (...args: infer A9) => void): any;
          (event: infer E10, listener: (...args: infer A10) => void): any;
          (event: infer E11, listener: (...args: infer A11) => void): any;
          (event: infer E12, listener: (...args: infer A12) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4> &
          TransformedEvent<TThis, E5, A5> &
          TransformedEvent<TThis, E6, A6> &
          TransformedEvent<TThis, E7, A7> &
          TransformedEvent<TThis, E8, A8> &
          TransformedEvent<TThis, E9, A9> &
          TransformedEvent<TThis, E10, A10> &
          TransformedEvent<TThis, E11, A11> &
          TransformedEvent<TThis, E12, A12>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: infer E4, listener: (...args: infer A4) => void): any;
          (event: infer E5, listener: (...args: infer A5) => void): any;
          (event: infer E6, listener: (...args: infer A6) => void): any;
          (event: infer E7, listener: (...args: infer A7) => void): any;
          (event: infer E8, listener: (...args: infer A8) => void): any;
          (event: infer E9, listener: (...args: infer A9) => void): any;
          (event: infer E10, listener: (...args: infer A10) => void): any;
          (event: infer E11, listener: (...args: infer A11) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4> &
          TransformedEvent<TThis, E5, A5> &
          TransformedEvent<TThis, E6, A6> &
          TransformedEvent<TThis, E7, A7> &
          TransformedEvent<TThis, E8, A8> &
          TransformedEvent<TThis, E9, A9> &
          TransformedEvent<TThis, E10, A10> &
          TransformedEvent<TThis, E11, A11>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: infer E4, listener: (...args: infer A4) => void): any;
          (event: infer E5, listener: (...args: infer A5) => void): any;
          (event: infer E6, listener: (...args: infer A6) => void): any;
          (event: infer E7, listener: (...args: infer A7) => void): any;
          (event: infer E8, listener: (...args: infer A8) => void): any;
          (event: infer E9, listener: (...args: infer A9) => void): any;
          (event: infer E10, listener: (...args: infer A10) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4> &
          TransformedEvent<TThis, E5, A5> &
          TransformedEvent<TThis, E6, A6> &
          TransformedEvent<TThis, E7, A7> &
          TransformedEvent<TThis, E8, A8> &
          TransformedEvent<TThis, E9, A9> &
          TransformedEvent<TThis, E10, A10>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: infer E4, listener: (...args: infer A4) => void): any;
          (event: infer E5, listener: (...args: infer A5) => void): any;
          (event: infer E6, listener: (...args: infer A6) => void): any;
          (event: infer E7, listener: (...args: infer A7) => void): any;
          (event: infer E8, listener: (...args: infer A8) => void): any;
          (event: infer E9, listener: (...args: infer A9) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4> &
          TransformedEvent<TThis, E5, A5> &
          TransformedEvent<TThis, E6, A6> &
          TransformedEvent<TThis, E7, A7> &
          TransformedEvent<TThis, E8, A8> &
          TransformedEvent<TThis, E9, A9>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: infer E4, listener: (...args: infer A4) => void): any;
          (event: infer E5, listener: (...args: infer A5) => void): any;
          (event: infer E6, listener: (...args: infer A6) => void): any;
          (event: infer E7, listener: (...args: infer A7) => void): any;
          (event: infer E8, listener: (...args: infer A8) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4> &
          TransformedEvent<TThis, E5, A5> &
          TransformedEvent<TThis, E6, A6> &
          TransformedEvent<TThis, E7, A7> &
          TransformedEvent<TThis, E8, A8>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: infer E4, listener: (...args: infer A4) => void): any;
          (event: infer E5, listener: (...args: infer A5) => void): any;
          (event: infer E6, listener: (...args: infer A6) => void): any;
          (event: infer E7, listener: (...args: infer A7) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4> &
          TransformedEvent<TThis, E5, A5> &
          TransformedEvent<TThis, E6, A6> &
          TransformedEvent<TThis, E7, A7>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: infer E4, listener: (...args: infer A4) => void): any;
          (event: infer E5, listener: (...args: infer A5) => void): any;
          (event: infer E6, listener: (...args: infer A6) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4> &
          TransformedEvent<TThis, E5, A5> &
          TransformedEvent<TThis, E6, A6>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: infer E4, listener: (...args: infer A4) => void): any;
          (event: infer E5, listener: (...args: infer A5) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4> &
          TransformedEvent<TThis, E5, A5>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: infer E4, listener: (...args: infer A4) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3> &
          TransformedEvent<TThis, E4, A4>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: infer E3, listener: (...args: infer A3) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2> &
          TransformedEvent<TThis, E3, A3>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: infer E2, listener: (...args: infer A2) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> &
          TransformedEvent<TThis, E1, A1> &
          TransformedEvent<TThis, E2, A2>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: infer E1, listener: (...args: infer A1) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0> & TransformedEvent<TThis, E1, A1>
    : TEvent extends {
          (event: infer E0, listener: (...args: infer A0) => void): any;
          (event: string, listener: (...args: any[]) => void): any;
      }
    ? TransformedEvent<TThis, E0, A0>
    : TransformedEvent<TThis, string, any[]>;

/**
 * @legacy
 * @alpha
 */
export type TypedEventTransform<TThis, TEvent> =
    // Event emitter supports some special events for the emitter itself to use
    // this exposes those events for the TypedEventEmitter.
    // Since we know what the shape of these events are, we can describe them directly via a TransformedEvent
    // which easier than trying to extend TEvent directly
    TransformedEvent<
        TThis,
        "newListener" | "removeListener",
        Parameters<(event: string, listener: (...args: any[]) => void) => void>
    > &
        // Expose all the events provides by TEvent
        IEventTransformer<TThis, TEvent & IEvent> &
        // Add the default overload so this is covertable to EventEmitter regardless of environment
        TransformedEvent<TThis, EventEmitterEventType, any[]>;

/**
 * Base interface for event providers.
 * @sealed @public
 */
export interface IEventProvider<TEvent extends IEvent> {
    /**
     * Registers a callback to be invoked when the corresponding event is triggered.
     */
    readonly on: IEventTransformer<this, TEvent>;

    /**
     * Registers a callback to be invoked the first time (after registration) the corresponding event is triggered.
     */
    readonly once: IEventTransformer<this, TEvent>;

    /**
     * Removes the corresponding event if it has been registered.
     */
    readonly off: IEventTransformer<this, TEvent>;
}

type AnyListener = (...args: any[]) => void;

/**
 * Event Emitter helper class the supports emitting typed events.
 *
 * @remarks
 * Implemented in-house rather than on the `events` npm polyfill: Retree only
 * needs `on` / `once` / `off` / `emit`, and the polyfill costs ~2.3 kB
 * min+gzip in consumer bundles. Semantics intentionally match Node's
 * `EventEmitter` where Retree depends on them:
 * - `emit` iterates a snapshot of the listener list, so a listener that
 *   unsubscribes (or subscribes) mid-emit never changes which listeners the
 *   current emit calls.
 * - `emit` returns whether any listener was registered for the event.
 * @privateRemarks
 * This should become internal once the classes extending it become internal.
 * @legacy
 * @alpha
 */
export class TypedEventEmitter<TEvent>
    implements IEventProvider<TEvent & IEvent>
{
    private readonly eventListeners = new Map<string, AnyListener[]>();

    public constructor() {
        const add = (event: string, listener: AnyListener): this => {
            const existing = this.eventListeners.get(event);
            if (existing === undefined) {
                this.eventListeners.set(event, [listener]);
            } else {
                existing.push(listener);
            }
            return this;
        };
        const remove = (event: string, listener: AnyListener): this => {
            const existing = this.eventListeners.get(event);
            if (existing === undefined) return this;
            const index = existing.lastIndexOf(listener);
            if (index === -1) return this;
            existing.splice(index, 1);
            if (existing.length === 0) {
                this.eventListeners.delete(event);
            }
            return this;
        };
        const once = (event: string, listener: AnyListener): this => {
            const wrapper: AnyListener = (...args) => {
                remove(event, wrapper);
                listener(...args);
            };
            return add(event, wrapper);
        };
        this.addListener = add as TypedEventTransform<this, TEvent>;
        this.on = add as TypedEventTransform<this, TEvent>;
        this.once = once as TypedEventTransform<this, TEvent>;
        this.removeListener = remove as TypedEventTransform<this, TEvent>;
        this.off = remove as TypedEventTransform<this, TEvent>;
    }

    public readonly addListener: TypedEventTransform<this, TEvent>;
    public readonly on: TypedEventTransform<this, TEvent>;
    public readonly once: TypedEventTransform<this, TEvent>;
    public readonly removeListener: TypedEventTransform<this, TEvent>;
    public readonly off: TypedEventTransform<this, TEvent>;

    public emit(event: string, ...args: any[]): boolean {
        const existing = this.eventListeners.get(event);
        if (existing === undefined) return false;
        if (existing.length === 1) {
            // Fast path for the by-far common case: this emitter fires on
            // every tree write, and Retree registers one global listener
            // per event type.
            existing[0](...args);
            return true;
        }
        for (const listener of [...existing]) {
            listener(...args);
        }
        return true;
    }
}
