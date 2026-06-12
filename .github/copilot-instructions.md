# Repository Workflow Instructions

## Branch Workflow

- Use `develop` as the normal working branch for implementation, documentation, tests, and commits.
- Do not commit directly to `master` unless the user explicitly asks for an emergency direct change.
- Keep local `master` aligned with `origin/master`; treat it as the protected integration target.
- Start new work from the latest `origin/develop` when it exists. If `develop` is missing in a new clone, create it from the latest remote integration branch before making changes.
- Push completed work to `origin/develop` or to a feature branch based on `develop`, according to the user's request.
- After validation and CI pass, open a pull request from `develop` to `master` for review and merge.

## Validation Before Push or PR

- Run the repository's standard checks before pushing code changes.
- Prefer validation commands documented in the repository's README, contributor guide, package scripts, Makefile, task runner, or CI configuration.
- If standard checks are not obvious, inspect the repo and run the smallest reliable validation set for the changed files.
- For documentation-only changes, a full test run is optional unless the user asks for it or the docs affect generated/tested content.
- If any validation cannot be run, state that clearly in the final summary.

## MCP Contract and Compatibility Guardrails

- Preserve existing MCP tool names, argument schemas, defaults, output shapes, and write-tool opt-in behavior unless a compatibility alias and deprecation path are part of the change.
- Treat `docs/tool-contracts.json`, `docs/api-snapshot.json`, and `src/skills.generated.ts` as generated guardrails. Do not edit them by hand.
- When tool contracts change intentionally, run `npm run gen:contracts` and review the JSON diff as a consumer-facing API change.
- When TypeScript declaration surfaces change intentionally, run `npm run build && npm run gen:api-snapshot` and review the snapshot diff as an npm-facing API change.
- When adding, removing, or renaming a skill module under `src/tools`, run `npm run gen:skills` and keep `src/skills.ts` as the metadata wrapper only.
- For compatibility migrations, prefer the facade in `src/compat.ts` for aliases and argument mapping instead of duplicating legacy handling inside individual tool modules.
- Keep write tools disabled by default. New mutating tools must remain gated behind the repository's write-enable policy and should provide `dry_run` support when practical.
- Validate compatibility-sensitive changes with `npm run build`, `npm test`, and, for packaging/API work, `npm pack --dry-run`.

## Git Hygiene

- Check `git status` before staging, committing, rebasing, or pushing.
- Stage only files related to the current task.
- Never overwrite or revert user changes unless the user explicitly requests it.
- If a push is rejected because the remote moved, fetch first, inspect the branch relationship, and rebase or merge according to the repo workflow.
- Prefer non-interactive git commands.
