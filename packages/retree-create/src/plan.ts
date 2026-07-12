import { PackageManager, TargetProject } from "./detect.js";

export interface InstallSelections {
    react: boolean;
    convex: boolean;
    skill: boolean;
}

export interface PlannedCommand {
    command: string;
    args: string[];
}

export interface InstallPlan {
    packageSpecs: string[];
    includesReactConvex: boolean;
    addsConvexPeer: boolean;
    warnMissingReact: boolean;
    installCommand: PlannedCommand;
    skillCommand: PlannedCommand | undefined;
}

const INSTALL_SUBCOMMANDS: Record<PackageManager, string> = {
    npm: "install",
    pnpm: "add",
    yarn: "add",
    bun: "add",
};

export const SKILL_INSTALL_COMMAND: PlannedCommand = {
    command: "npx",
    args: ["skills", "add", "ryanbliss/retree", "--skill", "retree"],
};

export function resolveInstallPlan(
    selections: InstallSelections,
    target: TargetProject,
    packageManager: PackageManager
): InstallPlan {
    const packageSpecs = ["@retreejs/core@latest"];
    if (selections.react) {
        packageSpecs.push("@retreejs/react@latest");
    }
    if (selections.convex) {
        packageSpecs.push("@retreejs/convex@latest");
    }

    const includesReactConvex = selections.react && selections.convex;
    if (includesReactConvex) {
        packageSpecs.push("@retreejs/react-convex@latest");
    }

    const addsConvexPeer = selections.convex && !target.hasConvex;
    if (addsConvexPeer) {
        packageSpecs.push("convex@latest");
    }

    const warnMissingReact = selections.react && !target.hasReact;

    return {
        packageSpecs,
        includesReactConvex,
        addsConvexPeer,
        warnMissingReact,
        installCommand: {
            command: packageManager,
            args: [INSTALL_SUBCOMMANDS[packageManager], ...packageSpecs],
        },
        skillCommand: selections.skill ? SKILL_INSTALL_COMMAND : undefined,
    };
}

export function formatPlannedCommand(plannedCommand: PlannedCommand): string {
    return [plannedCommand.command, ...plannedCommand.args].join(" ");
}
