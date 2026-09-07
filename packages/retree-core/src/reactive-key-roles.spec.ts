/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it } from "vitest";
import {
    COLLECTED_KEYS_SYMBOL,
    LINKED_KEYS_SYMBOL,
    ReactiveNode,
    SELECT_GETTERS_SYMBOL,
} from "./ReactiveNode.js";
import { ignore, link } from "./decorators.js";
import { buildReactiveKeyRoles, ReactiveKeyRole } from "./internals/memo.js";

class Parent extends ReactiveNode {
    public count = 0;
    @ignore
    public scratch = 0;
    @link
    public selected: { value: number } | null = null;
    public get doubled(): number {
        return this.count * 2;
    }
    public bump(): void {
        this.count++;
    }
}

class Child extends Parent {
    public get tripled(): number {
        return this.count * 3;
    }
}

describe("reactive key roles", () => {
    it("classifies collected, linked, and inherited getter keys", () => {
        const roles = buildReactiveKeyRoles(new Child());
        expect(roles.get("scratch")).toBe(ReactiveKeyRole.Collected);
        expect(roles.get("options")).toBe(ReactiveKeyRole.Collected);
        expect(roles.get(LINKED_KEYS_SYMBOL)).toBe(ReactiveKeyRole.Collected);
        expect(roles.get(SELECT_GETTERS_SYMBOL)).toBe(
            ReactiveKeyRole.Collected
        );
        expect(roles.get("selected")).toBe(ReactiveKeyRole.Linked);
        expect(roles.get("doubled")).toBe(ReactiveKeyRole.Getter);
        expect(roles.get("tripled")).toBe(ReactiveKeyRole.Getter);
        expect(roles.has("count")).toBe(false);
        expect(roles.has("bump")).toBe(false);
    });

    it("lets a collected key win over a getter of the same name", () => {
        const instance = new Child();
        instance[COLLECTED_KEYS_SYMBOL].add("doubled");
        expect(buildReactiveKeyRoles(instance).get("doubled")).toBe(
            ReactiveKeyRole.Collected
        );
    });
});
