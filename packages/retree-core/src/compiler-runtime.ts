/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Runtime imported by code that @retreejs/babel-plugin-compiler emits. Not a public API:
 * the accessor shapes and helper names are a contract between the compiler
 * and this package version.
 */
export {
    C,
    CompiledFieldRole,
    H,
    R,
    S,
    V,
    currentWriteVersion,
    defineCompiledNode,
    normalizeKey,
    readFunction,
    readGetterValue,
    readGetterWithFrame,
    readIgnored,
    readLinked,
    readObject,
    readPrimitive,
    recoverGetterRead,
    runCompiledMemoBody,
    sameKey,
    writeField,
    writeIgnored,
    writeLinked,
} from "./internals/compiled-node.js";
export type { CompiledNodeSchema } from "./internals/compiled-node.js";
