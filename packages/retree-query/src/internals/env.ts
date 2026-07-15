/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

declare const process:
    | { env?: { NODE_ENV?: string | undefined } | undefined }
    | undefined;

/**
 * Whether the runtime looks like a development build.
 *
 * @remarks
 * Reads `process.env.NODE_ENV` as a literal so bundlers can replace it and
 * dead-code-eliminate dev-only warnings from production builds. Environments
 * without `process` are treated as development.
 */
export function isDevMode(): boolean {
    if (typeof process === "undefined") {
        return true;
    }

    return process?.env?.NODE_ENV !== "production";
}
