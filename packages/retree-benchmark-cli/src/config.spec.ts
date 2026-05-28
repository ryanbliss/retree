import { describe, expect, it } from "vitest";
import { parseCliArgs, resolveBenchmarkConfig } from "./config";
import type { PromptAdapter } from "./config";
import { ProfileName, TIER_NAMES } from "./types";

describe("benchmark CLI config", () => {
    it("parses documented CLI options", () => {
        const parsed = parseCliArgs([
            "--profile",
            "smoke",
            "--output-dir=tmp/bench",
            "--tiers",
            "very-high",
            "--workers=2",
            "--no-interactive",
        ]);

        expect(parsed).toEqual({
            help: false,
            interactive: false,
            outputDir: "tmp/bench",
            profileName: "smoke",
            tierPreset: "veryHigh",
            workers: 2,
        });
    });

    it("defaults to all tiers without prompting in a non-TTY process", async () => {
        const config = await resolveBenchmarkConfig(parseCliArgs([]), {
            isTTY: false,
            promptAdapter: createFailingPromptAdapter(),
        });

        expect(config.profileName).toBe("stable");
        expect(config.selectedDepthTiers).toEqual([...TIER_NAMES]);
        expect(config.selectedFrequencyTiers).toEqual([...TIER_NAMES]);
        expect(config.parallelWorkers).toBeUndefined();
        expect(config.widthTiers.map((tier) => tier.key)).toEqual([
            ...TIER_NAMES,
        ]);
        expect(config.mutationTypes).toContain("scalar-set");
        expect(config.callbackReadModes).toContain("deep");
    });

    it("uses a shared tier preset for depth and frequency tiers", async () => {
        const config = await resolveBenchmarkConfig(
            parseCliArgs(["--tiers", "low"]),
            {
                isTTY: true,
                promptAdapter: createFailingPromptAdapter(),
            }
        );

        expect(config.selectedDepthTiers).toEqual(["low"]);
        expect(config.selectedFrequencyTiers).toEqual(["low"]);
        expect(config.parallelWorkers).toBeUndefined();
        expect(config.widthTiers.map((tier) => tier.key)).toEqual(["low"]);
    });

    it("supports an explicit worker count", async () => {
        const config = await resolveBenchmarkConfig(
            parseCliArgs(["--tiers", "low", "--workers", "3"]),
            {
                isTTY: false,
            }
        );

        expect(config.parallelWorkers).toBe(3);
    });

    it("supports custom interactive depth and frequency tier selections", async () => {
        const promptAdapter: PromptAdapter = {
            async chooseProfile() {
                return "exhaustive";
            },
            async chooseDepthTiers() {
                return ["low", "high"];
            },
            async chooseFrequencyTiers() {
                return ["medium"];
            },
            async chooseTierPreset() {
                return "custom";
            },
        };

        const config = await resolveBenchmarkConfig(parseCliArgs([]), {
            isTTY: true,
            promptAdapter,
        });

        expect(config.selectedDepthTiers).toEqual(["low", "high"]);
        expect(config.selectedFrequencyTiers).toEqual(["medium"]);
        expect(config.profileName).toBe("exhaustive");
    });

    it("bypasses the profile prompt when --profile is set but still prompts tiers", async () => {
        let profilePromptCount = 0;
        const promptAdapter: PromptAdapter = {
            async chooseProfile() {
                profilePromptCount++;
                return "exhaustive";
            },
            async chooseDepthTiers() {
                throw new Error("Depth prompt should not run in this test.");
            },
            async chooseFrequencyTiers() {
                throw new Error(
                    "Frequency prompt should not run in this test."
                );
            },
            async chooseTierPreset() {
                return "low";
            },
        };

        const config = await resolveBenchmarkConfig(
            parseCliArgs(["--profile", "smoke"]),
            {
                isTTY: true,
                promptAdapter,
            }
        );

        expect(profilePromptCount).toBe(0);
        expect(config.profileName).toBe("smoke");
        expect(config.selectedDepthTiers).toEqual(["low"]);
        expect(config.selectedFrequencyTiers).toEqual(["low"]);
    });

    it("prompts for a missing profile when --interactive is explicit", async () => {
        const promptAdapter: PromptAdapter = {
            async chooseProfile() {
                return "smoke";
            },
            async chooseDepthTiers() {
                throw new Error("Depth prompt should not run in this test.");
            },
            async chooseFrequencyTiers() {
                throw new Error(
                    "Frequency prompt should not run in this test."
                );
            },
            async chooseTierPreset() {
                throw new Error("Tier prompt should not run in this test.");
            },
        };

        const config = await resolveBenchmarkConfig(
            parseCliArgs(["--interactive", "--tiers", "low"]),
            {
                isTTY: true,
                promptAdapter,
            }
        );

        expect(config.profileName).toBe("smoke");
        expect(config.selectedDepthTiers).toEqual(["low"]);
        expect(config.selectedFrequencyTiers).toEqual(["low"]);
    });

    it("rejects ambiguous shared and independent tier flags", async () => {
        await expect(() =>
            resolveBenchmarkConfig(
                parseCliArgs(["--tiers", "low", "--depth-tiers", "medium"]),
                {
                    isTTY: false,
                }
            )
        ).rejects.toThrow(/Cannot combine --tiers with --depth-tiers/);
    });
});

function createFailingPromptAdapter(): PromptAdapter {
    return {
        async chooseProfile(): Promise<ProfileName> {
            throw new Error("Profile prompt should not run in this test.");
        },
        async chooseDepthTiers() {
            throw new Error("Depth prompt should not run in this test.");
        },
        async chooseFrequencyTiers() {
            throw new Error("Frequency prompt should not run in this test.");
        },
        async chooseTierPreset() {
            throw new Error("Tier preset prompt should not run in this test.");
        },
    };
}
