import { describe, expect, it } from "vitest";
import { parseCliFlags, resolveSelectionsFromFlags } from "./args.js";

describe("parseCliFlags", () => {
    it("returns undecided flags for an empty argv", () => {
        expect(parseCliFlags([])).toEqual({
            help: false,
            react: undefined,
            convex: undefined,
            eslint: undefined,
            coreOnly: false,
            skill: undefined,
            yes: false,
            packageManager: undefined,
        });
    });

    it("parses --help and -h", () => {
        expect(parseCliFlags(["--help"]).help).toBe(true);
        expect(parseCliFlags(["-h"]).help).toBe(true);
    });

    it("parses feature flags", () => {
        const flags = parseCliFlags(["--react", "--convex", "--eslint"]);
        expect(flags.react).toBe(true);
        expect(flags.convex).toBe(true);
        expect(flags.eslint).toBe(true);
    });

    it("parses --core-only", () => {
        expect(parseCliFlags(["--core-only"]).coreOnly).toBe(true);
    });

    it("parses --skill and --no-skill", () => {
        expect(parseCliFlags(["--skill"]).skill).toBe(true);
        expect(parseCliFlags(["--no-skill"]).skill).toBe(false);
    });

    it("parses --eslint and --no-eslint", () => {
        expect(parseCliFlags(["--eslint"]).eslint).toBe(true);
        expect(parseCliFlags(["--no-eslint"]).eslint).toBe(false);
    });

    it("parses --yes and -y", () => {
        expect(parseCliFlags(["--yes"]).yes).toBe(true);
        expect(parseCliFlags(["-y"]).yes).toBe(true);
    });

    it("parses --pm with a separate value", () => {
        expect(parseCliFlags(["--pm", "pnpm"]).packageManager).toBe("pnpm");
    });

    it("parses --pm=value", () => {
        expect(parseCliFlags(["--pm=bun"]).packageManager).toBe("bun");
    });

    it("throws when --pm has no value", () => {
        expect(() => parseCliFlags(["--pm"])).toThrow(
            '--pm requires a value. Pass one of "npm", "pnpm", "yarn", "bun".'
        );
    });

    it("throws when --pm has an unsupported value", () => {
        expect(() => parseCliFlags(["--pm", "cargo"])).toThrow(
            /--pm received "cargo"/
        );
    });

    it("throws for an unknown option", () => {
        expect(() => parseCliFlags(["--reactjs"])).toThrow(
            /Unknown option "--reactjs"/
        );
    });

    it("throws when --skill and --no-skill are combined", () => {
        expect(() => parseCliFlags(["--skill", "--no-skill"])).toThrow(
            "--skill and --no-skill were both passed. Pass only one of them."
        );
        expect(() => parseCliFlags(["--no-skill", "--skill"])).toThrow(
            "--skill and --no-skill were both passed. Pass only one of them."
        );
    });

    it("throws when --eslint and --no-eslint are combined", () => {
        expect(() => parseCliFlags(["--eslint", "--no-eslint"])).toThrow(
            "--eslint and --no-eslint were both passed. Pass only one of them."
        );
        expect(() => parseCliFlags(["--no-eslint", "--eslint"])).toThrow(
            "--eslint and --no-eslint were both passed. Pass only one of them."
        );
    });

    it("throws when --core-only is combined with --react", () => {
        expect(() => parseCliFlags(["--core-only", "--react"])).toThrow(
            /--core-only and --react were both passed/
        );
    });

    it("throws when --core-only is combined with --convex", () => {
        expect(() => parseCliFlags(["--core-only", "--convex"])).toThrow(
            /--core-only and --convex were both passed/
        );
    });

    it("throws when --core-only is combined with --eslint", () => {
        expect(() => parseCliFlags(["--core-only", "--eslint"])).toThrow(
            /--core-only and --eslint were both passed/
        );
    });
});

describe("resolveSelectionsFromFlags", () => {
    const detectedNone = { react: false, convex: false, eslint: false };
    const detectedAll = { react: true, convex: true, eslint: true };

    it("returns undefined when no deciding flags are passed", () => {
        expect(
            resolveSelectionsFromFlags(parseCliFlags([]), detectedAll)
        ).toBeUndefined();
    });

    it("returns undefined when only --skill is passed", () => {
        expect(
            resolveSelectionsFromFlags(parseCliFlags(["--skill"]), detectedAll)
        ).toBeUndefined();
    });

    it("selects only core for --core-only", () => {
        expect(
            resolveSelectionsFromFlags(
                parseCliFlags(["--core-only"]),
                detectedAll
            )
        ).toEqual({ react: false, convex: false, eslint: false, skill: false });
    });

    it("uses detection defaults for --yes, with the skill on", () => {
        expect(
            resolveSelectionsFromFlags(parseCliFlags(["--yes"]), detectedAll)
        ).toEqual({ react: true, convex: true, eslint: true, skill: true });
        expect(
            resolveSelectionsFromFlags(parseCliFlags(["--yes"]), detectedNone)
        ).toEqual({ react: false, convex: false, eslint: false, skill: true });
    });

    it("lets --no-skill override the --yes skill default", () => {
        expect(
            resolveSelectionsFromFlags(
                parseCliFlags(["--yes", "--no-skill"]),
                detectedNone
            )
        ).toEqual({ react: false, convex: false, eslint: false, skill: false });
    });

    it("treats explicit feature flags as the full selection, skill off", () => {
        expect(
            resolveSelectionsFromFlags(parseCliFlags(["--react"]), detectedAll)
        ).toEqual({ react: true, convex: false, eslint: false, skill: false });
    });

    it("adds the skill to explicit feature flags with --skill", () => {
        expect(
            resolveSelectionsFromFlags(
                parseCliFlags(["--convex", "--skill"]),
                detectedNone
            )
        ).toEqual({ react: false, convex: true, eslint: false, skill: true });
    });

    it("fills unset features from detection when --yes accompanies a feature flag", () => {
        expect(
            resolveSelectionsFromFlags(parseCliFlags(["--react", "--yes"]), {
                react: false,
                convex: true,
                eslint: true,
            })
        ).toEqual({ react: true, convex: true, eslint: true, skill: true });
    });

    it("lets --no-eslint override the detected --yes default", () => {
        expect(
            resolveSelectionsFromFlags(
                parseCliFlags(["--yes", "--no-eslint"]),
                detectedAll
            )
        ).toEqual({ react: true, convex: true, eslint: false, skill: true });
    });
});
