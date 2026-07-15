/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

// The deep-equality implementation moved to @retreejs/query (spec §6.2
// AsyncQueryNode extraction). This module stays as a compatibility shim for
// existing internal imports.
export { deepEquals } from "@retreejs/query";
