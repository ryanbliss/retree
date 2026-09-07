---
"@retreejs/create": minor
---

Offer `@retreejs/babel-plugin-compiler` when the target project has a Babel config (`--compiler` / `--no-compiler`), install it as a development dependency, and insert it ahead of `@babel/plugin-proposal-decorators` in JSON Babel configs, leaving JavaScript configs untouched with the manual step.
