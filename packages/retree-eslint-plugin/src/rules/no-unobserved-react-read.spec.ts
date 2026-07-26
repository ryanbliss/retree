import path from "node:path";
import { fileURLToPath } from "node:url";
import * as parser from "@typescript-eslint/parser";
import { RuleTester } from "@typescript-eslint/rule-tester";
import { Linter } from "eslint";
import { afterAll, describe, expect, it } from "vitest";
import { noUnobservedReactRead } from "./no-unobserved-react-read.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.itSkip = it.skip;

const packageDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
);
const fixtureFile = path.join(packageDirectory, "tests/fixture.tsx");
const wrapperFile = path.join(packageDirectory, "tests/wrapper.ts");

const ruleTester = new RuleTester({
    defaultFilenames: {
        ts: fixtureFile,
        tsx: fixtureFile,
    },
    languageOptions: {
        parser,
        parserOptions: {
            projectService: true,
            tsconfigRootDir: packageDirectory,
        },
    },
});

const types = `
interface Team { name: string }
interface Owner { name: string; team: Team }
interface Task { id: string; title: string }
interface Project { title: string; owner: Owner; tasks: Task[] }
`;

ruleTester.run("no-unobserved-react-read", noUnobservedReactRead, {
    valid: [
        {
            name: "allows direct fields owned by a useNode observation",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function ProjectTitle({ project }: { project: Project }) {
                    const state = useNode(project);
                    return <span>{state.title}</span>;
                }
            `,
        },
        {
            name: "allows a separately observed child node",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    const owner = useNode(state.owner);
                    return <span>{owner.name}</span>;
                }
            `,
        },
        {
            name: "allows descendant reads under useTree",
            code: `
                import { useTree } from "@retreejs/react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useTree(project);
                    return <span>{state.owner.team.name}</span>;
                }
            `,
        },
        {
            name: "suppresses ReactiveNode dependency paths until forwarding summaries are implemented",
            code: `
                import { ReactiveNode } from "@retreejs/core";
                import { useNode } from "@retreejs/react";
                ${types}
                class ProjectNode extends ReactiveNode {
                    owner: Owner = { name: "Ada", team: { name: "Core" } };
                    get dependencies() { return [this.owner]; }
                }
                function ProjectOwner({ project }: { project: ProjectNode }) {
                    const state = useNode(project);
                    return <span>{state.owner.name}</span>;
                }
            `,
        },
        {
            name: "resolves aliased and namespace Retree imports",
            code: `
                import { useNode as observe } from "@retreejs/react";
                import * as RetreeReact from "@retreejs/react";
                ${types}
                function ProjectTitle({ project }: { project: Project }) {
                    const state = observe(project);
                    const owner = RetreeReact.useNode(state.owner);
                    return <span>{owner.name}</span>;
                }
            `,
        },
        {
            name: "ignores unrelated same-named functions",
            code: `
                ${types}
                function useNode<T>(value: T): T { return value; }
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    return <span>{state.owner.name}</span>;
                }
            `,
        },
        {
            name: "does not inspect deferred callbacks",
            code: `
                import { useNode } from "@retreejs/react";
                import { useEffect } from "react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    useEffect(() => console.log(state.owner.name), []);
                    return <button onClick={() => console.log(state.owner.name)}>Read</button>;
                }
            `,
        },
        {
            name: "allows node references transferred to child components",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                declare function OwnerView(props: { owner: Owner }): JSX.Element;
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    return <OwnerView owner={state.owner} />;
                }
            `,
        },
        {
            name: "exempts JSX keys by default",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function TaskList({ project }: { project: Project }) {
                    const tasks = useNode(project.tasks);
                    return tasks.map((task) => <span key={task.id}>Task</span>);
                }
            `,
        },
        {
            name: "allows tree-mode useRaw descendant reads",
            code: `
                import { useRaw } from "@retreejs/react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const [raw] = useRaw(project, { listenerType: "treeChanged" });
                    return <span>{raw.owner.team.name}</span>;
                }
            `,
        },
        {
            name: "allows direct-child toManaged conversion with a child observation",
            code: `
                import { useNode, useRaw } from "@retreejs/react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const [raw, toManaged] = useRaw(project);
                    const owner = useNode(toManaged(raw.owner)!);
                    return <span>{owner.name}</span>;
                }
            `,
        },
        {
            name: "supports a configured file hook by resolved import identity",
            code: `
                import { useProjectNode } from "./wrapper.js";
                ${types}
                function ProjectTitle({ project }: { project: Project }) {
                    const state = useProjectNode(project);
                    return <span>{state.title}</span>;
                }
            `,
            options: [
                {
                    additionalHooks: [
                        {
                            file: wrapperFile,
                            export: "useProjectNode",
                            observes: "own",
                        },
                    ],
                },
            ],
        },
        {
            name: "honors configured raw-tree tuple coverage without inventing a converter",
            code: `
                import { useProjectRaw } from "./wrapper.js";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const [raw] = useProjectRaw(project);
                    return <span>{raw.owner.team.name}</span>;
                }
            `,
            options: [
                {
                    additionalHooks: [
                        {
                            file: wrapperFile,
                            export: "useProjectRaw",
                            observes: "raw-tree",
                            result: "tuple-first",
                        },
                    ],
                },
            ],
        },
    ],
    invalid: [
        {
            name: "reports an unresolved export for an encountered configured target",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function ProjectTitle({ project }: { project: Project }) {
                    const state = useNode(project);
                    return <span>{state.title}</span>;
                }
            `,
            options: [
                {
                    additionalHooks: [
                        {
                            package: "@retreejs/react",
                            export: "missingHook",
                            observes: "own",
                        },
                    ],
                },
            ],
            errors: [{ messageId: "invalidAdditionalHook" }],
        },
        {
            name: "reports the motivating nested read",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    return <span>{state.owner.name}</span>;
                }
            `,
            errors: [
                {
                    messageId: "unobservedNodeRead",
                    data: {
                        observedPath: "project",
                        observingHook: "useNode",
                        ownerPath: "state.owner",
                        readPath: "state.owner.name",
                    },
                },
            ],
        },
        {
            name: "tracks local object aliases",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    const owner = state.owner;
                    return <span>{owner.name}</span>;
                }
            `,
            errors: [{ messageId: "unobservedNodeRead" }],
        },
        {
            name: "tracks object destructuring",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    const { owner } = state;
                    const { name } = owner;
                    return <span>{name}</span>;
                }
            `,
            errors: [{ messageId: "unobservedNodeRead" }],
        },
        {
            name: "tracks optional member chains",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    return <span>{state.owner?.name}</span>;
                }
            `,
            errors: [{ messageId: "unobservedNodeRead" }],
        },
        {
            name: "reports an unobserved intermediate owner",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function TeamName({ project }: { project: Project }) {
                    const state = useNode(project);
                    const team = useNode(state.owner.team);
                    return <span>{team.name}</span>;
                }
            `,
            errors: [{ messageId: "unobservedNodeRead" }],
        },
        {
            name: "tracks array callback element provenance",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function TaskList({ project }: { project: Project }) {
                    const tasks = useNode(project.tasks);
                    return tasks.map((task) => <span>{task.title}</span>);
                }
            `,
            errors: [{ messageId: "unobservedNodeRead" }],
        },
        {
            name: "checks for-of collection reads",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function TaskList({ project }: { project: Project }) {
                    const state = useNode(project);
                    const rows = [];
                    for (const task of state.tasks) {
                        rows.push(<span key={task.id}>Task</span>);
                    }
                    return rows;
                }
            `,
            errors: [{ messageId: "unobservedNodeRead" }],
        },
        {
            name: "checks shallow spread reads of child nodes",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    return <pre>{JSON.stringify({ ...state.owner })}</pre>;
                }
            `,
            errors: [{ messageId: "unobservedNodeRead" }],
        },
        {
            name: "reports useRaw direct-child content with the safe conversion message",
            code: `
                import { useRaw } from "@retreejs/react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const [raw] = useRaw(project);
                    return <span>{raw.owner.name}</span>;
                }
            `,
            errors: [
                {
                    messageId: "unobservedDirectRawChildRead",
                    data: {
                        observedPath: "project",
                        rawOwnerPath: "raw.owner",
                        readPath: "raw.owner.name",
                    },
                },
            ],
        },
        {
            name: "does not treat a deep non-null toManaged call as a managed origin",
            code: `
                import { useNode, useRaw } from "@retreejs/react";
                ${types}
                function TeamName({ project }: { project: Project }) {
                    const [raw, toManaged] = useRaw(project);
                    const team = useNode(toManaged(raw.owner.team)!);
                    return <span>{team.name}</span>;
                }
            `,
            errors: [{ messageId: "unobservedDirectRawChildRead" }],
        },
        {
            name: "checks useMemo initializers",
            code: `
                import { useNode } from "@retreejs/react";
                import { useMemo } from "react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    return useMemo(() => state.owner.name, [state]);
                }
            `,
            errors: [{ messageId: "unobservedNodeRead" }],
        },
        {
            name: "checks deferred hook dependency arrays",
            code: `
                import { useNode } from "@retreejs/react";
                import { useEffect } from "react";
                ${types}
                function ProjectOwner({ project }: { project: Project }) {
                    const state = useNode(project);
                    useEffect(() => console.log(state.owner.name), [state.owner.name]);
                    return null;
                }
            `,
            errors: [{ messageId: "unobservedNodeRead" }],
        },
        {
            name: "checks JSX keys when configured",
            code: `
                import { useNode } from "@retreejs/react";
                ${types}
                function TaskList({ project }: { project: Project }) {
                    const tasks = useNode(project.tasks);
                    return tasks.map((task) => <span key={task.id}>Task</span>);
                }
            `,
            options: [{ checkJsxKeys: true }],
            errors: [{ messageId: "unobservedNodeRead" }],
        },
    ],
});

describe("no-unobserved-react-read configuration", () => {
    function verifyWithOptions(
        options: Record<string, unknown>
    ): Linter.LintMessage[] {
        const linter = new Linter({ configType: "flat" });
        return linter.verify(
            "export {};",
            [
                {
                    files: ["**/*.ts"],
                    plugins: {
                        "@retreejs": {
                            rules: {
                                "no-unobserved-react-read":
                                    noUnobservedReactRead,
                            },
                        },
                    },
                    rules: {
                        "@retreejs/no-unobserved-react-read": [
                            "error",
                            options,
                        ],
                    },
                },
            ],
            { filename: "fixture.ts" }
        );
    }

    it("rejects a relative baseDirectory with a pinpointed error", () => {
        expect(() => verifyWithOptions({ baseDirectory: "." })).toThrow(
            '@retreejs/no-unobserved-react-read: baseDirectory must be absolute; received ".".'
        );
    });

    it("rejects each relative file target without baseDirectory", () => {
        expect(() =>
            verifyWithOptions({
                additionalHooks: [
                    {
                        file: "src/state.ts",
                        export: "useProjectNode",
                        observes: "own",
                    },
                ],
            })
        ).toThrow(
            '@retreejs/no-unobserved-react-read: additionalHooks[0].file is relative ("src/state.ts"), but baseDirectory is not configured. Fix: provide an absolute file path or set baseDirectory to an absolute path.'
        );
    });

    it("fails clearly when typed parser services are unavailable", () => {
        const linter = new Linter({ configType: "flat" });
        expect(() =>
            linter.verify(
                "export {};",
                [
                    {
                        files: ["**/*.ts"],
                        languageOptions: { parser },
                        plugins: {
                            "@retreejs": {
                                rules: {
                                    "no-unobserved-react-read":
                                        noUnobservedReactRead,
                                },
                            },
                        },
                        rules: {
                            "@retreejs/no-unobserved-react-read": "error",
                        },
                    },
                ],
                { filename: "fixture.ts" }
            )
        ).toThrow(
            "@retreejs/no-unobserved-react-read requires TypeScript parser services. Fix: configure @typescript-eslint/parser with parserOptions.projectService (or parserOptions.project) for every file using this rule."
        );
    });
});
