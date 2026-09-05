import { expect, it } from "vitest";
import { memo, ReactiveNode, Retree } from "./index.js";

class DeclarationNode extends ReactiveNode {
    public omittedKey = "hidden";

    public childFor(key: string): boolean {
        return this.derivesOmittedKeyFromDeclaration(key);
    }

    @memo
    public get visible(): boolean {
        return this.childFor("hidden");
    }

    private derivesOmittedKeyFromDeclaration(key: string): boolean {
        return key !== this.omittedKey;
    }
}

it("calls private helpers through base proxies, memo getters, and retained reproxies", () => {
    class ChildNode extends DeclarationNode {}
    const root = Retree.root({ node: new ChildNode() });
    const node = root.node;
    const childFor = node.childFor;
    expect(childFor("hidden")).toBe(false);
    expect(node.visible).toBe(false);

    const observed: boolean[] = [];
    const stop = Retree.select(
        () => node.visible,
        (value) => observed.push(value)
    );
    node.omittedKey = "other";
    const retained = Retree.managed(node)!;
    expect(retained.childFor("hidden")).toBe(true);
    expect(retained.visible).toBe(true);
    node.omittedKey = "hidden";
    expect(retained.childFor("hidden")).toBe(false);
    expect(childFor("hidden")).toBe(false);
    expect(observed).toEqual([true, false]);
    stop();
});

it("resolves a helper added or replaced on a live class prototype", () => {
    const node = Retree.root(new DeclarationNode());
    expect(node.childFor("hidden")).toBe(false);
    const prototype = Object.create(Object.getPrototypeOf(Retree.raw(node)));
    Object.setPrototypeOf(Retree.raw(node), prototype);
    Object.defineProperty(prototype, "derivesOmittedKeyFromDeclaration", {
        configurable: true,
        value(this: DeclarationNode, key: string) {
            return key === this.omittedKey;
        },
    });
    expect(node.childFor("hidden")).toBe(true);
    expect(Retree.managed(node)!.childFor("hidden")).toBe(true);
});
