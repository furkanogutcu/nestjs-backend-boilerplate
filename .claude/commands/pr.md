---
description: Generates the PR and squash-merge texts (title + description) for this branch according to the repo template.
argument-hint: '[base-branch (default: main)]'
allowed-tools: Bash(git:*)
---

The user invoked the `/pr` command with the following arguments: `$ARGUMENTS`

Generates the **PR** and **squash-merge commit** texts from the work on this branch according to the repo template (authoritative source of the template: `CONTRIBUTING.md` "PR and squash-merge template"). `gh` is **not** installed → do not open the PR; produce the text and present it in copy-paste blocks. The generated **artifacts are in English** (the PR/commit goes into git history); your **report to the user is in Turkish**.

## Arguments

- The first positional argument = **base branch** (defaults to `main` if not provided).

## 1. Gather the git context

- Branch name: `git rev-parse --abbrev-ref HEAD`. Parse from the name: the leading `type` (`feat`/`fix`/`perf`/`refactor`/`docs`/`chore`/`test`/`style`/`ci`/`build`). Expected pattern: `<type>/<slug>`.
- Commits: `git log --reverse --format='%s' <base>..HEAD` — read the type distribution and scope from here.
- Change summary: `git diff --stat <base>...HEAD` (three dots).
- If needed, a focused `git diff <base>...HEAD -- <path>` to understand the content; **do not dump the entire large diff**, pick the important files from `--stat` and inspect those.
- If `<base>..HEAD` is empty or branch == base: **stop**, notify the user (there is nothing to generate).

## 2. Derive the Conventional Commits header

- `type` = the **highest-impact** type in the PR: `feat > fix > perf > refactor/docs/chore/test/style/ci/build`. (The squash header determines the version → reflect the most significant change.)
- `scope` = the dominant module/area (from commit scopes or the diff path); if unclear, **omit** the scope.
- `subject` = a single short phrase summarizing the whole PR: **lowercase, imperative, no period**.
- Length: **≤100 chars** (commitlint `header-max-length`). If it exceeds, shorten the subject.
- Is there a **breaking** change? (a `!`/`BREAKING CHANGE` in a commit, or an API/contract break in the diff) → if so, put `BREAKING CHANGE: <description>` in the squash body footer and fill in the Breaking changes section of the PR. Otherwise the Breaking section is `None`.

## 3. Generate the four texts (template — English)

**PR Title** (single line): `<type>(<scope>): <subject>`.

**PR Description** (Balanced):

```md
## Summary

<what + why, 1–2 sentences>

## Changes

- <notable change>

## Testing

- <how it was verified: unit / integration / e2e / manual + CI>

## Breaking changes

None <!-- or: description + migration note -->
```

**Squash Commit Title** (single line): **identical to the PR Title.** Do **not** append `(#PR-no)` at the end — GitHub adds it automatically on merge.

**Squash Commit Body**:

```
- <notable change>

BREAKING CHANGE: <description>   ← only if present
```

(Body lines ≤100.)

## 4. Present

- Present the four outputs as **separate fenced blocks**, each clearly labeled with what it is (PR Title / PR Description / Squash Commit Title / Squash Commit Body).
- If the diff touched API/schema files (`*.request.ts`, `*.response.ts`, controller, `openapi.json`) → add a reminder note: "The API appears to have changed — run `pnpm docs:generate` and commit `openapi.json`" (**outside** the artifacts, as a note; CI already catches drift).
- A short Turkish summary: which `type`/`scope` was chosen and why, and any breaking change.

## Notes

- `gh` is not installed → do **not** open the PR; only generate text.
- Follow commitlint rules: lowercase subject, no trailing period, header ≤100 chars.
