<!-- BEGIN:typescript-preferences -->

Always use the type system to your advantage. Do not force cast, preferring type guards, generics with inferred typing, etc.
Throw errors that give helpful information. Errors should be a single failure condition (e.g., `||` conditions when throwing should instead be separate `if` statements, each with their own unique error message). If a user were to send the developer a screenshot of the error, the developer should be able to pinpoint it to an exact line of code and know exactly what the failure was, without reproducing the error to see which `||` triggered that error to be thrown.
Do not go crazy with inline ternaries. Only one ternary per variable is acceptable.

<!-- END:typescript-preferences -->

<!-- BEGIN:verification-and-debugging-rules -->

Always test your changes (`npm run test`). If a test is failing, do not ignore it or assume it was pre-existing. Fix it.
Always run `npm run doctor` when you're finished with changes.

<!-- END:verification-and-debugging-rules -->

<!-- convex-ai-start -->

This project may have samples using [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

<!-- git-start -->

Don't add agent contributors to git commits.

<!-- git-end -->
