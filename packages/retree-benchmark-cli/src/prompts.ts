import { checkbox, select } from "@inquirer/prompts";
import { PromptAdapter } from "./config";
import { ProfileName, TierName, TierPreset, TIER_NAMES } from "./types";

const TIER_CHOICES = [
    {
        name: "Low",
        value: "low",
    },
    {
        name: "Medium",
        value: "medium",
    },
    {
        name: "High",
        value: "high",
    },
    {
        name: "Very high",
        value: "veryHigh",
    },
] satisfies Array<{ name: string; value: TierName }>;

export function createInquirerPromptAdapter(): PromptAdapter {
    return {
        async chooseProfile() {
            return select<ProfileName>({
                choices: [
                    {
                        name: "Stable (default)",
                        value: "stable",
                    },
                    {
                        name: "Smoke",
                        value: "smoke",
                    },
                    {
                        name: "Exhaustive",
                        value: "exhaustive",
                    },
                ],
                default: "stable",
                message: "Benchmark profile",
            });
        },
        async chooseTierPreset() {
            return select<TierPreset>({
                choices: [
                    {
                        name: "1 All",
                        value: "all",
                    },
                    {
                        name: "2 Low only",
                        value: "low",
                    },
                    {
                        name: "3 Medium only",
                        value: "medium",
                    },
                    {
                        name: "4 High only",
                        value: "high",
                    },
                    {
                        name: "5 Very high only",
                        value: "veryHigh",
                    },
                    {
                        name: "6 Custom",
                        value: "custom",
                    },
                ],
                message: "Benchmark tier selection",
            });
        },
        async chooseDepthTiers() {
            const tiers = await checkbox<TierName>({
                choices: TIER_CHOICES.map((choice) => ({
                    ...choice,
                    checked: TIER_NAMES.includes(choice.value),
                })),
                message: "Depth tiers",
            });
            assertPromptSelection(tiers, "depth");
            return tiers;
        },
        async chooseFrequencyTiers() {
            const tiers = await checkbox<TierName>({
                choices: TIER_CHOICES.map((choice) => ({
                    ...choice,
                    checked: TIER_NAMES.includes(choice.value),
                })),
                message: "Frequency tiers",
            });
            assertPromptSelection(tiers, "frequency");
            return tiers;
        },
    };
}

function assertPromptSelection(tiers: TierName[], tierKind: string) {
    if (tiers.length === 0) {
        throw new Error(
            `Interactive benchmark ${tierKind} tier selection cannot be empty.`
        );
    }
}
