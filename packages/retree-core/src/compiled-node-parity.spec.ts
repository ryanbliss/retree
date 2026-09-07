import { describe, expect, it } from "vitest";
import { ReactiveNode } from "./ReactiveNode.js";
import { Retree } from "./Retree.js";
import { memo, ignore } from "./decorators.js";

describe("compiled node semantic parity", () => {
    it("updates keys read inside ignored objects", () => {
        class Model extends ReactiveNode {
            @ignore config = { value: 1 };
            @memo((s: Model) => [s.config.value])
            get result() {
                return this.config.value * 2;
            }
        }
        const m = Retree.root(new Model());
        expect(m.result).toBe(2);
        m.config.value = 2;
        expect(m.result).toBe(4);
    });
    it("honors replacement of a compiled memo getter", () => {
        class Model extends ReactiveNode {
            count = 1;
            @memo((s: Model) => [s.count])
            get result() {
                return this.count;
            }
        }
        const m = Retree.root(new Model());
        expect(m.result).toBe(1);
        Object.defineProperty(Model.prototype, "result", {
            configurable: true,
            get() {
                return 42;
            },
        });
        m.count++;
        expect(m.result).toBe(42);
    });
    it("keeps custom toJSON in a compiled subclass", () => {
        class Base extends ReactiveNode {
            count = 1;
        }
        class Sub extends Base {
            toJSON() {
                return { custom: true };
            }
        }
        expect(JSON.stringify(Retree.root(new Sub()))).toBe('{"custom":true}');
    });
});

it("does not remove a child when the compiled destination rejects its key", () => {
    if (process.env.RETREE_COMPILED_SPECS !== "1") return;
    class Child extends ReactiveNode {
        value = 1;
    }
    class Holder extends ReactiveNode {
        child: Child | null = new Child();
    }
    const root = Retree.root(new Holder());
    const child = root.child!;
    const destination: { child: Child | null; missing?: Child } = root;
    expect(() => Retree.move(child, destination, "missing")).toThrow();
    expect(root.child).toBe(child);
    expect(Retree.parent(child)).toBe(root);
});

it("preserves memo bodies for base classes with the same declared name", () => {
    function makeBase() {
        class Model extends ReactiveNode {
            count = 1;
            @memo((s: Model) => [s.count]) get total(): number {
                return this.count * 2;
            }
        }
        return Model;
    }
    const Parent = makeBase();
    class Model extends Parent {
        @memo((s: Model) => [s.count]) get total(): number {
            return super.total + 1;
        }
    }
    const root = Retree.root(new Model());
    expect(root.total).toBe(3);
});

it("serves symbol fields inherited from an uncompiled base", () => {
    const key = Symbol("data");
    const Parent = class extends ReactiveNode {
        [key] = 5;
    };
    class Model extends Parent {
        @ignore label = "model";
    }
    const root = Retree.root(new Model());
    expect(root[key]).toBe(5);
});

it("preserves other decorators on a compiled memo getter", () => {
    function double(getter: (this: ReactiveNode) => number) {
        return function (this: ReactiveNode) {
            return getter.call(this) * 2;
        };
    }
    class Model extends ReactiveNode {
        count = 3;
        @memo((s: Model) => [s.count])
        @double
        get result() {
            return this.count;
        }
    }
    expect(Retree.root(new Model()).result).toBe(6);
});
