---
name: retree-github
description: Use before publishing GitHub PRs and/or opening issues.
---

Always finish by preparing a PR. Attach screenshots of any UI changes, and code snippets of public SDK API changes + before/after for existing APIs. GitHub plugin & `gh` is never auth'd in your sandbox, so ALWAYS escalate CLI commands. Don't include agent in git commit authors (against company policy).

Upload screenshots with GitHub CLI 2.99+ using the repeatable `--attach` flag. Reference each local path in the Markdown body and pass the same path to `gh pr create`, `gh pr edit`, or `gh pr comment` so `gh` rewrites it in place. Do not commit PR evidence images to the repository; branch-backed links break when the branch is deleted.

PR descriptions should clearly say what problem it fixes, what your solution is, what other solutions you considered, and why you chose the solution you did. Do not list new follow up items discovered during work in the PR description without opening an issue and linking to it. Follow up issues should clearly state why you chose not to fix in the PR. Ensure unaddressed linked issues won't be closed when the PR merges.

GitHub issues should clearly explain what the issue is, its impact, expected behavior, and other key context implementing agent needs. Relevant code snippets are helpful. Assign appropriate issue labels. Don't open duplicate issues.
