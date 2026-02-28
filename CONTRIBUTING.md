# Contributing

Thanks for taking the time to contribute! Please follow these guidelines to keep changes smooth and safe.

## Getting Started
- Fork and clone the repo; create a feature branch from `feature/security-review` (or current working branch).
- Install dependencies: `npm install --legacy-peer-deps`.
- Run tests before changes: `npm test` (or targeted suites when applicable).

## Branch & Commit Hygiene
- Use small, focused PRs; prefer incremental changes.
- Commit messages: conventional style (e.g., `feat:`, `fix:`, `docs:`, `chore:`).
- Keep PR titles clear and scoped (problem + approach).

## Coding Standards
- TypeScript/JavaScript: follow existing patterns; prefer typed interfaces and Zod schemas for validation.
- Security: never commit secrets; keep `.env` local; run `npm run security:secrets`.
- Linting/formatting: match current style; run `npm run check` if in doubt.
- Tests: add/adjust tests for changed behavior; ensure `npm test` passes.

## Pull Requests
- Describe the change, rationale, and user impact.
- Note any known limitations or follow-ups.
- Include screenshots for UI changes when relevant.
- Tag reviewers familiar with the area (API, frontend, infra, ops).

## Reporting Issues
- Use clear reproduction steps, expected vs actual behavior, and logs/traces if available.
- For security issues, **do not open an issue**—email security@krystaline.io (see SECURITY.md).

## Code of Conduct
Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
