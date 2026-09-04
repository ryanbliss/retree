<!-- BEGIN:intro -->

# Retree

Retree is a simple state framework for precise, lightning-fast reactive rendering. It is primarily designed for use with React.

## Note from Ryan

Hi, I'm Ryan, the creator of Retree. Hi, I'm Ryan. I'm an engineer, game developer, product manager, and UX designer.

I like bold ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Machinery should be as minimal as possible and serve clear purpose. Understand real constraints, then fight for the smallest model that makes the correct behavior unsurprising. Value precise, measured performance.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

I am hoping to bring MVVM back to React. Specifically, I want to have focused view models that can be more tightly coupled to the React component tree. Most state frameworks have top-level global state, or perhaps many different React Context providers. I've used a variety of state frameworks at scale and none have felt like they strike the right balance. Getting React to have precise rendering in a complex, deep view tree is incredibly challenging. Retree is my attempt to make that better.

Performance is critical in Retree. My app Neo Compose is using Retree in a large React app using Convex. Retree is the most common cause of performance issues, usually due to deep proxy traps. We have numerous APIs to help solve those problems, but it is our job to make performance as automatic as possible. Where things can't be automatic, aim to provide intuitive APIs that set our developers up for success.

<!-- END:intro -->

<!-- BEGIN:taste -->

## Code taste

Neo is complicated. Our job to make complicated things simpler. Fight for simple, elegant solutions that are coherent.

### 1. Type safe

Use type systems to your advantage.

✅ GOOD

-   Type guards for safe narrowing.
-   Generics with inferred typing.
-   Explicit type signatures.

❌ BAD

-   Force casting via `as unknown as T`.
-   Giant types that make narrowing state behavior difficult.
-   `any` is the enemy.

### 2. Precise errors

Throw errors with helpful information. Errors should be a single failure condition (e.g., `||` conditions when throwing should instead be separate `if` statements, each with their own unique error message). If a user were to send the developer a screenshot of the error, the developer should be able to pinpoint the exact line of code and know exactly what the failure was, without reproducing the error to see which `||` triggered that error to be thrown.

### 3. Readability

We like clean minimal code that balance legibility with minimality.

✅ GOOD

-   One ternary per variable.
-   Minimal, concise comments only as needed.

❌ BAD

-   Stacking multiple inline ternaries.
-   Writing novels in comments.

Try to honor the dev's intent in both a minimal and realistic fashion.

### 4. Anti-bloat

Do not pollute runtime app code with infra that only unit tests use. Doing so adds debt & bloat that can degrade the UX and code quality. Run `npm run lint:architecture` to enforce this invariant. Put legitimate test support under a `test-fixtures`, `__fixtures__`, or `__mocks__` directory instead of runtime source. The only non-fixture exceptions are exact, reason-bearing entries in `DORMANT_OPERATIONAL_INFRASTRUCTURE_EXEMPTIONS`. Reserve for repeatable operational infrastructure that is intentionally dormant until a migration or repair pulls it in as needed.

### 5. Performant algorithms

Write efficient, performant algorithms. Do not underestimate the scale of Neo record counts, as O(n)² issues are common and fatal if you aren't careful. Seek opportunities to improve and reuse existing code.

```ts
// ❌ BAD
function toEvenSorted(values: { num: number }[]): number[] {
    // map/filter already returns new list for sort, cloning is USELESS.
    // map and filter each loop through same list, WASTEFUL.
    return [...numbers]
        .map((n) => n.num)
        .filter((n) => n % 2 === 0)
        .sort((a, b) => a - b);
}
// ✅ GOOD
function toEvenSorted(values: { num: number }[]): number[] {
    // one loop builds mapped + filtered list
    const even: number[] = [];
    for (const n of values) {
        if (n.num % 2 === 0) continue;
        even.push(n.num);
    }
    return even.sort((a, b) => a - b);
}
```

### 6. Data structures

Use forward-thinking data structures, like using enums instead of booleans.

### 7. Reuse

Look for existing code so that business logic stays consistent and can be changed centrally.

### 8. UI

Keep UI dumb and business logic centralized (e.g., in Retree view models).

## Copywriting

Write copy in sentence-style capitalization. Value conciseness. Use help text VERY sparingly. Use unslop skill.

Don't show count text in UI for lists without permission.

<!-- END:taste -->

<!-- BEGIN:verification-and-debugging-rules -->

## Verification

Always test your changes. If a test is failing, do not ignore it or assume it was pre-existing. Fix it.

Avoid test bloat. Write tests that focus on unique behavior of what you are testing rather than duplicating coverage that already exists elsewhere.

Always test your changes (`npm run test`). If a test is failing, do not ignore it or assume it was pre-existing. Fix it.

Always run `npm run doctor` before publishing your PR.

<!-- END:verification-and-debugging-rules -->

<!-- git-start -->

## Git

Don't add agent contributors to git commits.

<!-- git-end -->

<!-- convex-ai-start -->

This project may have samples using [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
