import { describe, expect, it } from "vitest";

import {
    buildNpmPublishArguments,
    parsePublishArguments,
    selectPackagesToPublish,
} from "./publish-package-selection.mjs";

describe("publish package selection", () => {
    it("keeps the existing lockstep family as the default", () => {
        const packages = selectPackagesToPublish(undefined);

        expect(packages.map((entry) => entry.label)).toEqual([
            "@retreejs/core",
            "@retreejs/query",
            "@retreejs/react",
            "@retreejs/devtools",
            "@retreejs/convex",
            "@retreejs/react-convex",
            "@retreejs/create",
        ]);
    });

    it("selects exactly one package by npm name", () => {
        const options = parsePublishArguments([
            "--package",
            "@retreejs/react-eslint-plugin",
            "--provenance",
        ]);
        const packages = selectPackagesToPublish(options.packageName);

        expect(options).toEqual({
            dryRunOnly: false,
            packageName: "@retreejs/react-eslint-plugin",
            showHelp: false,
            useProvenance: true,
        });
        expect(packages.map((entry) => entry.label)).toEqual([
            "@retreejs/react-eslint-plugin",
        ]);
    });

    it("supports the equals form", () => {
        const options = parsePublishArguments([
            "--package=@retreejs/react-eslint-plugin",
        ]);

        expect(options.packageName).toBe("@retreejs/react-eslint-plugin");
    });

    it("parses a non-publishing dry run", () => {
        const options = parsePublishArguments(["--dry-run"]);

        expect(options.dryRunOnly).toBe(true);
    });

    it.each([
        {
            args: ["--package"],
            message:
                "Publish arguments: --package requires an exact package name.",
        },
        {
            args: ["--package", "--provenance"],
            message:
                "Publish arguments: --package requires a package name before --provenance.",
        },
        {
            args: ["--package="],
            message:
                "Publish arguments: --package= requires an exact package name.",
        },
        {
            args: ["--wat"],
            message: "Publish arguments: unknown argument --wat.",
        },
    ])("rejects malformed arguments: $args", ({ args, message }) => {
        expect(() => parsePublishArguments(args)).toThrow(message);
    });

    it("rejects repeated package selectors", () => {
        expect(() =>
            parsePublishArguments([
                "--package",
                "@retreejs/core",
                "--package=@retreejs/react",
            ])
        ).toThrow("Publish arguments: --package may only be provided once.");
    });

    it("lists every allowed package when selection is unknown", () => {
        expect(() => selectPackagesToPublish("@retreejs/missing")).toThrow(
            "Publish arguments: unknown package @retreejs/missing. Expected one of: @retreejs/core, @retreejs/query, @retreejs/react, @retreejs/devtools, @retreejs/convex, @retreejs/react-convex, @retreejs/create, @retreejs/react-eslint-plugin."
        );
    });

    it("publishes a new scoped package with public access", () => {
        expect(
            buildNpmPublishArguments({
                isNewPackage: true,
                useProvenance: false,
            })
        ).toEqual(["publish", "--access", "public"]);
    });

    it("adds provenance without changing existing-package access", () => {
        expect(
            buildNpmPublishArguments({
                isNewPackage: false,
                useProvenance: true,
            })
        ).toEqual(["publish", "--provenance"]);
    });
});
