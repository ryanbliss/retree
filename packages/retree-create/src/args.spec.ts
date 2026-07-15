import { describe, expect, it } from "vitest";
import { parseCliFlags, resolveSelectionsFromFlags } from "./args.js";

describe("parseCliFlags", () => {
    it("returns undecided flags for an empty argv", () => {
        expect(parseCliFlags([])).toEqual({
            help: false,
            react: undefined,
            convex: undefined,
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
        const flags = parseCliFlags(["--react", "--convex"]);
        expect(flags.react).toBe(true);
        expect(flags.convex).toBe(true);
    });

    it("parses --core-only", () => {
        expect(parseCliFlags(["--core-only"]).coreOnly).toBe(true);
    });

    it("parses --skill and --no-skill", () => {
        expect(parseCliFlags(["--skill"]).skill).toBe(true);
        expect(parseCliFlags(["--no-skill"]).skill).toBe(false);
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
});

describe("resolveSelectionsFromFlags", () => {
    const detectedNone = { react: false, convex: false };
    const detectedBoth = { react: true, convex: true };

    it("returns undefined when no deciding flags are passed", () => {
        expect(
            resolveSelectionsFromFlags(parseCliFlags([]), detectedBoth)
        ).toBeUndefined();
    });

    it("returns undefined when only --skill is passed", () => {
        expect(
            resolveSelectionsFromFlags(parseCliFlags(["--skill"]), detectedBoth)
        ).toBeUndefined();
    });

    it("selects only core for --core-only", () => {
        expect(
            resolveSelectionsFromFlags(
                parseCliFlags(["--core-only"]),
                detectedBoth
            )
        ).toEqual({ react: false, convex: false, skill: false });
    });

    it("uses detection defaults for --yes, with the skill on", () => {
        expect(
            resolveSelectionsFromFlags(parseCliFlags(["--yes"]), detectedBoth)
        ).toEqual({ react: true, convex: true, skill: true });
        expect(
            resolveSelectionsFromFlags(parseCliFlags(["--yes"]), detectedNone)
        ).toEqual({ react: false, convex: false, skill: true });
    });

    it("lets --no-skill override the --yes skill default", () => {
        expect(
            resolveSelectionsFromFlags(
                parseCliFlags(["--yes", "--no-skill"]),
                detectedNone
            )
        ).toEqual({ react: false, convex: false, skill: false });
    });

    it("treats explicit feature flags as the full selection, skill off", () => {
        expect(
            resolveSelectionsFromFlags(parseCliFlags(["--react"]), detectedBoth)
        ).toEqual({ react: true, convex: false, skill: false });
    });

    it("adds the skill to explicit feature flags with --skill", () => {
        expect(
            resolveSelectionsFromFlags(
                parseCliFlags(["--convex", "--skill"]),
                detectedNone
            )
        ).toEqual({ react: false, convex: true, skill: true });
    });

    it("fills unset features from detection when --yes accompanies a feature flag", () => {
        expect(
            resolveSelectionsFromFlags(parseCliFlags(["--react", "--yes"]), {
                react: false,
                convex: true,
            })
        ).toEqual({ react: true, convex: true, skill: true });
    });
});
