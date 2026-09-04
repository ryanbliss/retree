---
"@retreejs/core": patch
"@retreejs/react": minor
---

Resolve only the requested raw child in useRaw. Pass `toManaged(row, { key: index })` to skip the raw slot lookup when the index, property, or Map key is known. Existing value lookup remains supported and indexes raw slots once per node version without materializing other children.
