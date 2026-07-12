import { checkbox, confirm } from "@inquirer/prompts";
import { InstallSelections } from "./plan.js";

export interface FeatureDefaults {
    react: boolean;
    convex: boolean;
}

export interface PromptAdapter {
    chooseFeatures(defaults: FeatureDefaults): Promise<InstallSelections>;
    confirmPlan(): Promise<boolean>;
}

type FeatureValue = "react" | "convex" | "skill";

export function createInquirerPromptAdapter(): PromptAdapter {
    return {
        async chooseFeatures(defaults) {
            const values = await checkbox<FeatureValue>({
                message:
                    "What would you like to add? (@retreejs/core is always installed)",
                choices: [
                    {
                        name: "React hooks (@retreejs/react)",
                        value: "react",
                        checked: defaults.react,
                        description: "useNode, useTree, useSelect, useRoot",
                    },
                    {
                        name: "Convex integration (@retreejs/convex)",
                        value: "convex",
                        checked: defaults.convex,
                        description:
                            "Live query nodes, mutations, reconciliation",
                    },
                    {
                        name: "Retree AI skill",
                        value: "skill",
                        checked: true,
                        description:
                            'Agent docs via "npx skills add ryanbliss/retree"',
                    },
                ],
            });
            return {
                react: values.includes("react"),
                convex: values.includes("convex"),
                skill: values.includes("skill"),
            };
        },
        async confirmPlan() {
            return confirm({ message: "Proceed?", default: true });
        },
    };
}
