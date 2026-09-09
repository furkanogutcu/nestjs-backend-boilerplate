# Contributing guide

This file describes the **process** (commits, branches, PRs, hooks, releases). **How code is written**
lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`AGENTS.md`](./AGENTS.md) — it is not repeated here.

## Requirements

- **pnpm** (package manager) and **Node ≥22**.
- **Docker** for integration/e2e tests (Testcontainers spins up PostgreSQL, Redis and MinIO).
- For setup and local execution → [`README.md`](./README.md) "Quick start".

## Development workflow

1. If the work maps to a task, open it in the issue/task tracker and note its ID (e.g. `#<n>`). Skip this step for task-less work.
2. Branch off `main`: `git switch -c <type>/<[<issue>-]short-description>` (e.g. `feat/<n>-auth-module`). See "Branch and PR naming".
3. Make the change; if behavior changes, **add tests** (the `nestjs-testing` skill).
4. Commit using Conventional Commits (see below).
5. Push and open a PR against `main`. The PR title must also be Conventional Commits (because of squash merge — see below). CI must be green.
6. Merge the PR into `main` via **squash merge**.
7. Versioning is **automatic** after merge (see "Release") — no manual version bumps.

## Branch and PR naming

Most work maps to a task in an issue/task tracker; when it does, the task ID (e.g. `#<n>`) appears in the branch and PR. For small work that does not correspond to a task (a dependency bump, a minor chore, an urgent hotfix, a docs fix), the ID is **optional** — see "Task-less PRs" below.

**Branch:** `<type>/<TASK-ID>-<short-description>` (without an ID, `<type>/<short-description>`)

- `type`: same as the Conventional Commits type (`feat`, `fix`, `chore`, `refactor`, `docs`…).
- `TASK-ID`: the issue/task tracker's ID, **uppercase** (`#<n>`). Included when present.
- Description: short, `kebab-case`, 2–4 words.
- Examples: `feat/<n>-auth-module` · `fix/<n>-token-refresh` · `chore/bump-eslint`.

**PR title:** `<type>(<scope>): <subject> (TASK-ID)` (without an ID, the trailing parenthetical is dropped)

- In Conventional Commits format; the task ID, if any, in parentheses at the end.
- Example: `feat(auth): add login and token refresh (#<n>)` · `chore(deps): bump eslint to 9.x`.
- **Why Conventional Commits is required:** the PR is taken via **squash merge**, so the PR title becomes the subject of the single commit on `main`, and semantic-release derives the version from it (see "Release"). A wrongly formatted title → wrong or missing versioning.

**PR body:** a link to the task, if any, + a short summary. If the issue/task tracker is connected to GitHub, an ID reference in the body/title links the task automatically. Full template: ["PR and squash-merge template"](#pr-and-squash-merge-template) (and the `/pr` command).

### Task-less PRs

Not every PR needs a task. When opening a task would be disproportionate to the work (a one-line fix, a dependabot/dependency bump, a docs typo, an urgent hotfix), a branch and PR may be opened directly:

- Omit the task ID from the branch and PR title; the remaining rules (Conventional Commits, squash merge, green CI) still apply.
- State in one sentence **why there is no task** in the PR body (e.g. "trivial dep bump," "hotfix for prod").
- As a rule of thumb: if the work is worth tracking or prioritizing, or if it changes user-visible behavior, **open a task first**. When in doubt, open a task.

> This project uses **squash merge**: intermediate commits on the branch are unconstrained; the **PR title** is what matters. Merge commits and rebase merges are not used.

## Commit rules (Conventional Commits)

The `commit-msg` hook enforces this via **commitlint** — `@commitlint/config-conventional` plus two local rules
in `commitlint.config.mjs` that enforce the single-line and no-trailer rules below. Format:
`type(scope): subject` — e.g. `feat(users): add profile endpoint`.

| Type                                                              | Version impact | Usage                   |
| ----------------------------------------------------------------- | -------------- | ----------------------- |
| `feat`                                                            | minor          | New feature             |
| `fix`                                                             | patch          | Bug fix                 |
| `perf`                                                            | patch          | Performance improvement |
| `docs` · `chore` · `refactor` · `test` · `style` · `ci` · `build` | none           | No version bump         |

- **Breaking change:** add `BREAKING CHANGE: ...` to the footer or a `!` to the type (`feat!: ...`) → **major**.
- The subject is short, imperative, and lowercase; it does not end with a period.
- **The commit message is a single line:** only the `type(scope): subject` subject line is written, with **no body** (e.g. `feat(auth): add guest login`). The agent likewise provides no body in the commit messages it proposes. Enforced by the `body-empty` rule; a footer is not a body, so `BREAKING CHANGE:` and `Refs:` still pass.
  - **Exception — the squash-merge commit:** this rule is for _development_ commits. When a PR is squash-merged, the commit that lands on `main` is a release/history artifact; the PR title becomes the subject, and the commit may carry a **structured body** (notable-change items + a `BREAKING CHANGE:`/`Refs:` footer). This body does not pollute the changelog (the changelog is generated only from the subject + `BREAKING CHANGE`). Template: ["PR and squash-merge template"](#pr-and-squash-merge-template).
- The entire commit message is written in **English**; Turkish commit messages are neither committed nor proposed.
- **No** co-author/trailer line (e.g. `Co-Authored-By:`, `Signed-off-by:`) is added to the commit message. Enforced by the local `footer-trailers-allowlist` rule, which admits only `BREAKING CHANGE` and `Refs` as footer tokens.

## PR and squash-merge template

PRs are taken via **squash merge**: a single commit lands on `main`, the **PR title** becomes that commit's subject, and semantic-release derives the version from it. The templates below are for this flow. To generate these texts automatically from your branch, use the **`/pr`** command (it derives them from git history; it does not open the PR, it produces the text).

### PR title / squash commit title

```
<type>(<scope>): <subject> (#<n>)
```

- Conventional Commits; `subject` is lowercase, imperative, with no trailing period; **≤100 chars** including `(#<n>)`.
- `type` = the highest-impact commit type in the PR (**feat > fix > perf > others**) — the squash header determines the version.
- Task-less PR → the trailing `(#<n>)` is dropped.
- The squash commit title is **identical to the PR title**; GitHub appends `(#<PR-no>)` at merge (do not add it manually).

### PR description

```md
## Summary

<what + why, 1–2 sentences>

## Changes

- <notable change>

## Testing

- <how it was verified: unit / integration / e2e / manual + CI>

## Breaking changes

None <!-- or: description + migration note -->

## References

- Closes #<n> <!-- related issue(s), if any; otherwise omit this section -->
```

> All artifacts (subject, body, changelog) are in **English**.
>
> If the API/schema changed, run `pnpm docs:generate` and commit `openapi.json` — otherwise the CI drift check fails.

### Squash commit body

```
- <notable change>

BREAKING CHANGE: <description>   ← only if present
Refs: #<n>
```

- Unlike development commits, the squash commit carries a **structured body** (a release/history artifact). The body **does not pollute the changelog**: the changelog is generated only from the subject + `BREAKING CHANGE`.
- Related issue(s) are linked in the footer with `Refs:`. Lines are ≤100 chars.

## Git hooks (husky)

| Hook         | Runs                                       |
| ------------ | ------------------------------------------ |
| `pre-commit` | `pnpm lint && pnpm typecheck`              |
| `commit-msg` | commitlint (message format)                |
| `pre-push`   | `pnpm lint && pnpm typecheck && pnpm test` |

Skipping hooks (`--no-verify`) is for exceptional cases only; CI re-checks the same gates anyway.

## CI and pre-merge

CI runs on every PR: **lint**, **type-check**, **OpenAPI drift check** (is `openapi.json` up to date),
**unit (coverage)**, **dependency audit**, and **integration + e2e** (Testcontainers). Do not merge until all are green.

> If you changed the API, run `pnpm docs:generate` and commit `openapi.json` — otherwise the drift check fails.

## Release

On every merge to `main`, **semantic-release** runs: it determines the next version from the commits (in a squash merge, the commit generated from the PR title),
generates `CHANGELOG.md`, regenerates `openapi.json`, writes the version to `package.json`, and
creates a GitHub release. The version and CHANGELOG are **not edited by hand** — they are derived from Conventional Commits.
The release commit is marked with `[skip ci]`.
