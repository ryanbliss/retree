#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const supportPath =
    /(?:^|\/)(?:mock|mocks|__mocks__|__fixtures__|test-fixtures|testing)(?:\/|$)|\.(?:spec|test|testing)\.[cm]?[jt]sx?$/;

export function findRuntimeTestImports(file, source) {
    if (supportPath.test(file)) return [];
    const errors = [];
    const syntax = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    function inspect(specifier) {
        const target = specifier.startsWith(".")
            ? resolve(dirname(file), specifier)
            : specifier;
        const framework =
            /^(?:vitest(?:\/|$)|@vitest\/|@testing-library\/|@jest\/|jest$|node:test$)/.test(
                specifier
            );
        if (framework || supportPath.test(target))
            errors.push(
                `${file}: runtime import of test support '${specifier}'`
            );
    }
    function visit(node) {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteralLike(node.moduleSpecifier)
        )
            inspect(node.moduleSpecifier.text);
        if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference)
        ) {
            const expression = node.moduleReference.expression;
            if (expression && ts.isStringLiteralLike(expression))
                inspect(expression.text);
        }
        if (
            ts.isCallExpression(node) &&
            node.arguments.length === 1 &&
            ts.isStringLiteralLike(node.arguments[0])
        ) {
            if (
                node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) &&
                    node.expression.text === "require")
            )
                inspect(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    }
    visit(syntax);
    return errors;
}

async function audit() {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const errors = [];
    async function walk(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const file = join(directory, entry.name);
            if (entry.isDirectory()) await walk(file);
            else if (/\.[cm]?[jt]sx?$/.test(entry.name))
                errors.push(
                    ...findRuntimeTestImports(
                        relative(root, file),
                        await readFile(file, "utf8")
                    )
                );
        }
    }
    for (const entry of await readdir(join(root, "packages"), {
        withFileTypes: true,
    })) {
        if (!entry.isDirectory()) continue;
        const source = join(root, "packages", entry.name, "src");
        try {
            await walk(source);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
    if (errors.length > 0) throw new Error(errors.join("\n"));
    console.log("SDK runtime/test import boundaries passed.");
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
    await audit();
