# 0001 Public Repo Security Posture

Date: 2026-05-07
Status: accepted

## Decision

`Etoro-Dashboard` may be developed in a public Git repository, but the codebase must be treated as security-sensitive because it can connect to financial accounts and may later support trading actions.

## Consequences

- No real secrets, private account data, exports, screenshots, or generated private fixtures may be committed.
- The app must keep eToro credentials server-side.
- Trading actions must be disabled by default and require explicit design, confirmation, tests, and feature flags.
- AI coding agents must read `AGENTS.md` before changing the project.

