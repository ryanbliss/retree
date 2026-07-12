import Link from "next/link";
import type { Metadata } from "next";
import { getApiManifest } from "@/lib/api-docs";

export const metadata: Metadata = {
    title: "API reference",
    description:
        "Generated API reference for every Retree package, rebuilt from the TypeScript source on each deploy.",
};

export default async function ApiIndexPage() {
    const manifest = await getApiManifest();

    return (
        <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
            <p className="font-mono text-xs uppercase tracking-widest text-faint">
                API reference
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                Packages
            </h1>
            <p className="mt-3 max-w-xl text-muted">
                Generated from the TypeScript source on every build — the
                reference can never drift from the code.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {manifest.packages.map((pkg) => (
                    <Link
                        key={pkg.slug}
                        href={`/api/${pkg.slug}`}
                        className="group rounded-xl border border-border-token bg-surface p-5 transition-colors hover:border-border-strong"
                    >
                        <p className="font-mono text-sm font-semibold text-accent">
                            {pkg.npmName}
                        </p>
                        <p className="mt-1 font-mono text-xs text-faint">
                            v{pkg.version}
                        </p>
                        <p className="mt-3 text-sm leading-6 text-muted">
                            {pkg.description}
                        </p>
                    </Link>
                ))}
            </div>
        </main>
    );
}
