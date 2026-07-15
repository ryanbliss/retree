/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

declare const process: { env: { NODE_ENV?: string | undefined } };

/**
 * Whether the runtime looks like a development build.
 *
 * @remarks
 * Reads `process.env.NODE_ENV` as the literal member expression so bundlers
 * that define it (Vite and webpack do by default; esbuild via `define`)
 * replace it with a constant — production bundles then return `false` here
 * even when no `process` global exists at runtime. The `try/catch` handles
 * runtimes with neither a `process` global nor a bundler define (a bare
 * `<script type="module">` browser page): those run in dev mode, which is
 * the safe noisy default. Do not "harden" this with a `typeof process`
 * guard or optional chaining — both short-circuit before the replaced
 * literal is evaluated, which flips define-using browser bundles into dev
 * mode. Note dev-only warnings are cheap runtime-gated checks; full
 * dead-code elimination through this function is not guaranteed and not
 * required.
 *
 * @internal
 */
export function isDevMode(): boolean {
    try {
        return process.env.NODE_ENV !== "production";
    } catch {
        // ReferenceError: no `process` global and no bundler define.
        return true;
    }
}
