# @retreejs/react

## 0.9.0

### Minor Changes

-   b040d1c: Resolve only the requested raw child in useRaw. Pass `toManaged(row, { key: index })` to skip the raw slot lookup when the index, property, or Map key is known. Existing value lookup remains supported and indexes raw slots once per node version without materializing other children.

    Share raw slot and result validation with the prepared child resolver to avoid duplicate reads during keyed resolution.

### Patch Changes

-   26b5161: Keep raw child lookup correct after silent structural writes by validating its slot index against write history instead of React render versions. Unrelated writes reuse the index; unknown or expired history triggers a conservative rebuild.

    Shorten repeated ownership, move, and uninitialized-support diagnostics while retaining their failure conditions and recovery guidance.

-   3129073: Validate changed tracked dependencies before rerunning useSelect selectors. Unrelated field writes reuse the previous selection while relevant changes and dependency replacements remain observable.

## 0.8.0

## 0.7.2

### Patch Changes

-   @retreejs/core@0.7.2
