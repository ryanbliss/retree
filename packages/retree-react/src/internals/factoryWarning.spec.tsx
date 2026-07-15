import React from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, MockInstance } from "vitest";
import { Retree, TreeNode } from "@retreejs/core";
import { useNode } from "../useNode.js";
import { useTree } from "../useTree.js";
import { useRaw } from "../useRaw.js";
import { useSelect } from "../useSelect.js";

describe("node factory reset warning", () => {
    let warnSpy: MockInstance;

    function spyOnWarn() {
        warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    }

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    function factoryWarnings(): string[] {
        return warnSpy.mock.calls
            .map((call) => String(call[0]))
            .filter((message) => message.includes("node factory"));
    }

    interface HookScenario {
        hookName: "useNode" | "useTree" | "useRaw" | "useSelect";
        renderHookWithInlineRootFactory(): void;
    }

    const scenarios: HookScenario[] = [
        {
            hookName: "useNode",
            renderHookWithInlineRootFactory() {
                useNode(() => Retree.root({ count: 0 }));
            },
        },
        {
            hookName: "useTree",
            renderHookWithInlineRootFactory() {
                useTree(() => Retree.root({ count: 0 }));
            },
        },
        {
            hookName: "useRaw",
            renderHookWithInlineRootFactory() {
                useRaw(() => Retree.root({ count: 0 }));
            },
        },
        {
            hookName: "useSelect",
            renderHookWithInlineRootFactory() {
                useSelect(
                    () => Retree.root({ count: 0 }),
                    (node) => node.count
                );
            },
        },
    ];

    for (const scenario of scenarios) {
        it(`${scenario.hookName} warns once per hook instance when an inline factory resolves a fresh root every render`, () => {
            spyOnWarn();
            function Component() {
                scenario.renderHookWithInlineRootFactory();
                return null;
            }

            const { rerender } = render(<Component />);
            rerender(<Component />);
            rerender(<Component />);
            expect(factoryWarnings()).toHaveLength(0);

            // Third consecutive resolved-node change crosses the threshold.
            rerender(<Component />);
            const warnings = factoryWarnings();
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain(scenario.hookName);
            expect(warnings[0]).toContain("useRoot");

            // Once per hook instance: further renders stay silent.
            rerender(<Component />);
            rerender(<Component />);
            expect(factoryWarnings()).toHaveLength(1);
        });
    }

    it("does not warn when an inline factory resolves the same node every render", () => {
        spyOnWarn();
        const root = Retree.root({ child: { count: 0 } });
        function Component() {
            useNode(() => root.child);
            return null;
        }

        const { rerender } = render(<Component />);
        for (let renderIndex = 0; renderIndex < 5; renderIndex++) {
            rerender(<Component />);
        }
        expect(factoryWarnings()).toHaveLength(0);
    });

    it("does not warn for plain node arguments that change identity across renders", () => {
        spyOnWarn();
        function Component({ node }: { node: TreeNode }) {
            useNode(node);
            return null;
        }

        const { rerender } = render(
            <Component node={Retree.root({ count: 0 })} />
        );
        for (let renderIndex = 0; renderIndex < 5; renderIndex++) {
            rerender(<Component node={Retree.root({ count: 0 })} />);
        }
        expect(factoryWarnings()).toHaveLength(0);
    });

    it("resets the consecutive-change count when the resolved node stabilizes", () => {
        spyOnWarn();
        let factoryResult = Retree.root({ count: 0 });
        function Component() {
            useNode(() => factoryResult);
            return null;
        }

        const { rerender } = render(<Component />);
        // Two changes, then a stable stretch, then two more changes: never
        // more than two consecutive changes, so no warning.
        factoryResult = Retree.root({ count: 0 });
        rerender(<Component />);
        factoryResult = Retree.root({ count: 0 });
        rerender(<Component />);
        rerender(<Component />);
        factoryResult = Retree.root({ count: 0 });
        rerender(<Component />);
        factoryResult = Retree.root({ count: 0 });
        rerender(<Component />);
        expect(factoryWarnings()).toHaveLength(0);
    });

    it("does not warn in production mode", () => {
        vi.stubEnv("NODE_ENV", "production");
        spyOnWarn();
        function Component() {
            useNode(() => Retree.root({ count: 0 }));
            return null;
        }

        const { rerender } = render(<Component />);
        for (let renderIndex = 0; renderIndex < 5; renderIndex++) {
            rerender(<Component />);
        }
        expect(factoryWarnings()).toHaveLength(0);
    });
});
