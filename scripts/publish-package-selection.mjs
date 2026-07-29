export const publishPackageCatalog = [
    {
        label: "@retreejs/core",
        directory: "packages/retree-core",
        publishByDefault: true,
    },
    {
        label: "@retreejs/query",
        directory: "packages/retree-query",
        publishByDefault: true,
    },
    {
        label: "@retreejs/react",
        directory: "packages/retree-react",
        publishByDefault: true,
    },
    {
        label: "@retreejs/devtools",
        directory: "packages/retree-devtools",
        publishByDefault: true,
    },
    {
        label: "@retreejs/convex",
        directory: "packages/retree-convex",
        publishByDefault: true,
    },
    {
        label: "@retreejs/react-convex",
        directory: "packages/retree-react-convex",
        publishByDefault: true,
    },
    {
        label: "@retreejs/create",
        directory: "packages/retree-create",
        publishByDefault: true,
    },
    {
        label: "@retreejs/react-eslint-plugin",
        directory: "packages/retree-react-eslint-plugin",
        publishByDefault: false,
    },
];

export function parsePublishArguments(args) {
    let dryRunOnly = false;
    let packageName;
    let showHelp = false;
    let useProvenance = false;

    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === "--help") {
            showHelp = true;
            continue;
        }
        if (argument === "--provenance") {
            useProvenance = true;
            continue;
        }
        if (argument === "--dry-run") {
            dryRunOnly = true;
            continue;
        }
        if (argument === "--package") {
            if (packageName !== undefined) {
                throw new Error(
                    "Publish arguments: --package may only be provided once."
                );
            }
            const value = args[index + 1];
            if (value === undefined) {
                throw new Error(
                    "Publish arguments: --package requires an exact package name."
                );
            }
            if (value.startsWith("--")) {
                throw new Error(
                    `Publish arguments: --package requires a package name before ${value}.`
                );
            }
            packageName = value;
            index++;
            continue;
        }
        if (argument.startsWith("--package=")) {
            if (packageName !== undefined) {
                throw new Error(
                    "Publish arguments: --package may only be provided once."
                );
            }
            const value = argument.slice("--package=".length);
            if (value.length === 0) {
                throw new Error(
                    "Publish arguments: --package= requires an exact package name."
                );
            }
            packageName = value;
            continue;
        }

        throw new Error(`Publish arguments: unknown argument ${argument}.`);
    }

    return { dryRunOnly, packageName, showHelp, useProvenance };
}

export function selectPackagesToPublish(packageName) {
    if (packageName === undefined) {
        return publishPackageCatalog.filter((entry) => entry.publishByDefault);
    }

    const selectedPackage = publishPackageCatalog.find(
        (entry) => entry.label === packageName
    );
    if (selectedPackage === undefined) {
        const packageNames = publishPackageCatalog
            .map((entry) => entry.label)
            .join(", ");
        throw new Error(
            `Publish arguments: unknown package ${packageName}. Expected one of: ${packageNames}.`
        );
    }

    return [selectedPackage];
}

export function buildNpmPublishArguments({ isNewPackage, useProvenance }) {
    const args = ["publish"];
    if (isNewPackage) {
        args.push("--access", "public");
    }
    if (useProvenance) {
        args.push("--provenance");
    }
    return args;
}
