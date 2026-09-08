# @retreejs/create

## 0.11.0

### Minor Changes

-   7e8c1ea: Offer `@retreejs/babel-plugin-compiler` as an opt-in when the target project has a Babel config (`--compiler`; off under `--yes` unless passed), install it as a development dependency, and insert it ahead of `@babel/plugin-proposal-decorators` in JSON Babel configs, leaving JavaScript configs untouched with the manual step.

## 0.10.4

## 0.10.3

## 0.10.2

## 0.10.1

## 0.10.0

## 0.9.0

## 0.8.0

## 0.7.2

### Patch Changes

-   4c62f50: Teach the Retree installer to detect compatible React, ESLint, and TypeScript projects, offer the React observation rule by default, install it as a development dependency, and safely update recognizable `eslint.config.mjs` files with a warning-only fallback for custom configs.

    Document the now-published React ESLint plugin and its TypeScript preset, and preserve the installer CLI's executable mode in npm packages.
