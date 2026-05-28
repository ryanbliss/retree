import path from "node:path";
import {
    BenchmarkConfig,
    ParsedCliArgs,
    ProfileDefinition,
    ProfileName,
    TierDefinition,
    TierName,
    TierPreset,
    TIER_NAMES,
} from "./types";

export interface PromptAdapter {
    chooseProfile(): Promise<ProfileName>;
    chooseTierPreset(): Promise<TierPreset>;
    chooseDepthTiers(): Promise<TierName[]>;
    chooseFrequencyTiers(): Promise<TierName[]>;
}

export interface ResolveConfigOptions {
    isTTY: boolean;
    promptAdapter?: PromptAdapter;
}

export const DEFAULT_OUTPUT_DIR = path.join("benchmarks", "results");
export const DEFAULT_SEED = 422_024;
export const DEFAULT_DEPENDENCY_DEPTHS = [1, 3, 5];

const TIER_TITLES: Record<TierName, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    veryHigh: "Very high",
};

export const PROFILES: Record<ProfileName, ProfileDefinition> = {
    smoke: {
        name: "smoke",
        title: "Smoke",
        depthTiers: createTierMap({
            low: 1,
            medium: 2,
            high: 3,
            veryHigh: 5,
        }),
        frequencyTiers: createTierMap({
            low: 2,
            medium: 5,
            high: 10,
            veryHigh: 20,
        }),
        widthTiers: createTierMap({
            low: 1,
            medium: 2,
            high: 4,
            veryHigh: 8,
        }),
        callbackReadModes: ["none"],
        dependencyFanouts: [2],
        effectWrites: [1],
        listenerFanouts: [2],
        mutationTypes: ["scalar-set", "array-push"],
        transactionMutations: [2],
        warmupCommits: 2,
    },
    stable: {
        name: "stable",
        title: "Stable",
        depthTiers: createTierMap({
            low: 2,
            medium: 5,
            high: 10,
            veryHigh: 20,
        }),
        frequencyTiers: createTierMap({
            low: 20,
            medium: 50,
            high: 150,
            veryHigh: 300,
        }),
        widthTiers: createTierMap({
            low: 1,
            medium: 4,
            high: 12,
            veryHigh: 32,
        }),
        callbackReadModes: ["none", "deep"],
        dependencyFanouts: [5, 25],
        effectWrites: [1, 5],
        listenerFanouts: [5, 25],
        mutationTypes: [
            "scalar-set",
            "array-push",
            "object-replace",
            "map-set",
            "set-add",
        ],
        transactionMutations: [10, 100],
        warmupCommits: 10,
    },
    exhaustive: {
        name: "exhaustive",
        title: "Exhaustive",
        depthTiers: createTierMap({
            low: 3,
            medium: 8,
            high: 15,
            veryHigh: 30,
        }),
        frequencyTiers: createTierMap({
            low: 100,
            medium: 500,
            high: 1000,
            veryHigh: 2500,
        }),
        widthTiers: createTierMap({
            low: 4,
            medium: 16,
            high: 64,
            veryHigh: 256,
        }),
        callbackReadModes: ["none", "shallow", "deep"],
        dependencyFanouts: [10, 100, 1000],
        effectWrites: [1, 5, 25],
        listenerFanouts: [10, 100, 1000],
        mutationTypes: [
            "scalar-set",
            "array-push",
            "object-replace",
            "map-set",
            "set-add",
        ],
        transactionMutations: [10, 100, 1000],
        warmupCommits: 50,
    },
};

function createTierMap(values: Record<TierName, number>) {
    return {
        low: createTierDefinition("low", values.low),
        medium: createTierDefinition("medium", values.medium),
        high: createTierDefinition("high", values.high),
        veryHigh: createTierDefinition("veryHigh", values.veryHigh),
    };
}

function createTierDefinition(
    tierName: TierName,
    value: number
): TierDefinition {
    return {
        key: tierName,
        title: TIER_TITLES[tierName],
        value,
    };
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
    const parsed: ParsedCliArgs = {
        help: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const current = argv[index];
        const option = parseOptionToken(current);

        if (option.name === "--help" || option.name === "-h") {
            parsed.help = true;
            continue;
        }
        if (option.name === "--interactive") {
            parsed.interactive = true;
            continue;
        }
        if (option.name === "--no-interactive") {
            parsed.interactive = false;
            continue;
        }
        if (option.name === "--profile") {
            const value = readOptionValue(argv, index, option);
            index = value.nextIndex;
            parsed.profileName = parseProfileName(value.value);
            continue;
        }
        if (option.name === "--output-dir") {
            const value = readOptionValue(argv, index, option);
            index = value.nextIndex;
            parsed.outputDir = value.value;
            continue;
        }
        if (option.name === "--tiers") {
            const value = readOptionValue(argv, index, option);
            index = value.nextIndex;
            parsed.tierPreset = parseTierPreset(value.value);
            continue;
        }
        if (option.name === "--depth-tiers") {
            const value = readOptionValue(argv, index, option);
            index = value.nextIndex;
            parsed.depthTiers = parseTierList(value.value, "--depth-tiers");
            continue;
        }
        if (option.name === "--frequency-tiers") {
            const value = readOptionValue(argv, index, option);
            index = value.nextIndex;
            parsed.frequencyTiers = parseTierList(
                value.value,
                "--frequency-tiers"
            );
            continue;
        }
        if (option.name === "--workers") {
            const value = readOptionValue(argv, index, option);
            index = value.nextIndex;
            parsed.workers = parseWorkerCount(value.value);
            continue;
        }

        throw new Error(`Unknown benchmark CLI option: ${current}`);
    }

    return parsed;
}

export async function resolveBenchmarkConfig(
    parsed: ParsedCliArgs,
    options: ResolveConfigOptions
): Promise<BenchmarkConfig> {
    if (parsed.tierPreset !== undefined) {
        if (parsed.depthTiers !== undefined) {
            throw new Error(
                "Cannot combine --tiers with --depth-tiers. Use --tiers for a shared tier preset or --depth-tiers for independent selection."
            );
        }
        if (parsed.frequencyTiers !== undefined) {
            throw new Error(
                "Cannot combine --tiers with --frequency-tiers. Use --tiers for a shared tier preset or --frequency-tiers for independent selection."
            );
        }
    }

    const shouldPromptProfile = shouldPromptForProfile(parsed, options.isTTY);
    const shouldPromptTiers = shouldPromptForTiers(parsed, options.isTTY);
    const promptAdapter = options.promptAdapter;
    let profileName: ProfileName;
    let selectedDepthTiers: TierName[];
    let selectedFrequencyTiers: TierName[];

    if (shouldPromptProfile || shouldPromptTiers) {
        if (promptAdapter === undefined) {
            throw new Error(
                "Interactive benchmark configuration requested, but no prompt adapter was provided."
            );
        }
    }

    if (shouldPromptProfile) {
        if (promptAdapter === undefined) {
            throw new Error(
                "Interactive benchmark profile selection requested, but no prompt adapter was provided."
            );
        }
        profileName = await promptAdapter.chooseProfile();
    } else {
        profileName = parsed.profileName ?? "stable";
    }

    if (shouldPromptTiers) {
        if (promptAdapter === undefined) {
            throw new Error(
                "Interactive benchmark tier selection requested, but no prompt adapter was provided."
            );
        }
        const preset = await promptAdapter.chooseTierPreset();
        if (preset === "custom") {
            selectedDepthTiers = await promptAdapter.chooseDepthTiers();
            selectedFrequencyTiers = await promptAdapter.chooseFrequencyTiers();
        } else {
            selectedDepthTiers = expandTierPreset(preset);
            selectedFrequencyTiers = expandTierPreset(preset);
        }
    } else {
        selectedDepthTiers = resolveDepthTiers(parsed);
        selectedFrequencyTiers = resolveFrequencyTiers(parsed);
    }

    const profile = PROFILES[profileName];
    assertSelectedTiers(selectedDepthTiers, "depth");
    assertSelectedTiers(selectedFrequencyTiers, "frequency");

    return {
        callbackReadModes: [...profile.callbackReadModes],
        dependencyDepths: [...DEFAULT_DEPENDENCY_DEPTHS],
        dependencyFanouts: [...profile.dependencyFanouts],
        effectWrites: [...profile.effectWrites],
        listenerFanouts: [...profile.listenerFanouts],
        mutationTypes: [...profile.mutationTypes],
        outputDir: parsed.outputDir ?? DEFAULT_OUTPUT_DIR,
        parallelWorkers: parsed.workers,
        profile,
        profileName,
        seed: DEFAULT_SEED,
        selectedDepthTiers,
        selectedFrequencyTiers,
        transactionMutations: [...profile.transactionMutations],
        widthTiers: resolveWidthTiers(profile, selectedDepthTiers),
    };
}

export function renderHelp() {
    return [
        "Retree benchmark CLI",
        "",
        "Usage:",
        "  retree-benchmark [options]",
        "",
        "Options:",
        "  --profile smoke|stable|exhaustive",
        "  --output-dir <dir>",
        "  --tiers all|low|medium|high|very-high",
        "  --depth-tiers <comma-separated tiers>",
        "  --frequency-tiers <comma-separated tiers>",
        "  --workers <count>",
        "  --interactive",
        "  --no-interactive",
        "  -h, --help",
    ].join("\n");
}

function shouldPromptForProfile(parsed: ParsedCliArgs, isTTY: boolean) {
    if (parsed.profileName !== undefined) {
        return false;
    }
    if (parsed.interactive === false) {
        return false;
    }
    if (parsed.interactive === true) {
        return true;
    }
    if (!isTTY) {
        return false;
    }
    return !hasTierSelection(parsed);
}

function shouldPromptForTiers(parsed: ParsedCliArgs, isTTY: boolean) {
    if (hasTierSelection(parsed)) {
        return false;
    }
    if (parsed.interactive === false) {
        return false;
    }
    if (parsed.interactive === true) {
        return true;
    }
    return isTTY;
}

function hasTierSelection(parsed: ParsedCliArgs) {
    if (parsed.tierPreset !== undefined) {
        return true;
    }
    if (parsed.depthTiers !== undefined) {
        return true;
    }
    if (parsed.frequencyTiers !== undefined) {
        return true;
    }
    return false;
}

function resolveDepthTiers(parsed: ParsedCliArgs) {
    if (parsed.depthTiers !== undefined) {
        return parsed.depthTiers;
    }
    if (parsed.tierPreset !== undefined) {
        return expandTierPreset(parsed.tierPreset);
    }
    return [...TIER_NAMES];
}

function resolveFrequencyTiers(parsed: ParsedCliArgs) {
    if (parsed.frequencyTiers !== undefined) {
        return parsed.frequencyTiers;
    }
    if (parsed.tierPreset !== undefined) {
        return expandTierPreset(parsed.tierPreset);
    }
    return [...TIER_NAMES];
}

function resolveWidthTiers(
    profile: ProfileDefinition,
    selectedDepthTiers: TierName[]
) {
    return selectedDepthTiers.map((tierName) => profile.widthTiers[tierName]);
}

function expandTierPreset(preset: Exclude<TierPreset, "custom">) {
    if (preset === "all") {
        return [...TIER_NAMES];
    }
    return [preset];
}

function parseProfileName(value: string): ProfileName {
    if (value === "smoke") {
        return value;
    }
    if (value === "stable") {
        return value;
    }
    if (value === "exhaustive") {
        return value;
    }
    throw new Error(
        `Invalid --profile value "${value}". Expected smoke, stable, or exhaustive.`
    );
}

function parseWorkerCount(value: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        throw new Error(
            `Invalid --workers value "${value}". Worker count must be a whole number.`
        );
    }
    if (parsed < 1) {
        throw new Error(
            `Invalid --workers value "${value}". Worker count must be at least 1.`
        );
    }
    return parsed;
}

function parseTierPreset(value: string): Exclude<TierPreset, "custom"> {
    if (value === "all") {
        return value;
    }
    return parseSingleTier(value, "--tiers");
}

function parseTierList(value: string, optionName: string) {
    if (value.trim().length === 0) {
        throw new Error(`${optionName} requires at least one tier value.`);
    }
    const parsed: TierName[] = [];
    for (const rawTier of value.split(",")) {
        const trimmedTier = rawTier.trim();
        if (trimmedTier.length === 0) {
            throw new Error(
                `${optionName} contains an empty tier entry in "${value}".`
            );
        }
        parsed.push(parseSingleTier(trimmedTier, optionName));
    }
    return parsed;
}

function parseSingleTier(value: string, optionName: string): TierName {
    if (value === "low") {
        return "low";
    }
    if (value === "medium") {
        return "medium";
    }
    if (value === "high") {
        return "high";
    }
    if (value === "very-high") {
        return "veryHigh";
    }
    if (value === "veryHigh") {
        return "veryHigh";
    }
    throw new Error(
        `Invalid ${optionName} tier "${value}". Expected low, medium, high, or very-high.`
    );
}

function assertSelectedTiers(tiers: TierName[], tierKind: string) {
    if (tiers.length === 0) {
        throw new Error(
            `Benchmark ${tierKind} tier selection cannot be empty.`
        );
    }
}

interface ParsedOptionToken {
    inlineValue?: string;
    name: string;
}

function parseOptionToken(token: string): ParsedOptionToken {
    const equalsIndex = token.indexOf("=");
    if (equalsIndex === -1) {
        return {
            name: token,
        };
    }
    return {
        inlineValue: token.slice(equalsIndex + 1),
        name: token.slice(0, equalsIndex),
    };
}

function readOptionValue(
    argv: string[],
    currentIndex: number,
    option: ParsedOptionToken
) {
    if (option.inlineValue !== undefined) {
        if (option.inlineValue.length === 0) {
            throw new Error(`${option.name} requires a non-empty value.`);
        }
        return {
            nextIndex: currentIndex,
            value: option.inlineValue,
        };
    }

    const value = argv[currentIndex + 1];
    if (value === undefined) {
        throw new Error(`${option.name} requires a value.`);
    }
    if (value.startsWith("--")) {
        throw new Error(`${option.name} requires a value before ${value}.`);
    }
    return {
        nextIndex: currentIndex + 1,
        value,
    };
}
