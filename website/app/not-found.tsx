import Link from "next/link";

export default function NotFound() {
    return (
        <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-faint">
                404
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
                Page not found
            </h1>
            <p className="mt-3 text-muted">
                The node you followed has no parent here. Try one of these:
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link
                    href="/docs/quick-start"
                    className="rounded-lg bg-accent-glow px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
                >
                    Quickstart
                </Link>
                <Link
                    href="/docs/thinking-in-retree"
                    className="rounded-lg border border-border-token px-4 py-2 text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                    Thinking in Retree
                </Link>
                <Link
                    href="/api"
                    className="rounded-lg border border-border-token px-4 py-2 text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                    API reference
                </Link>
            </div>
        </main>
    );
}
