# Etoro Dashboard Agent Memory

Status: active
Last updated: 2026-05-07

## Current Truth

- Project name: `Etoro-Dashboard`.
- Location: `/Users/yogi/Coding/projects/Etoro-Dashboard`.
- Intended repository visibility: public is acceptable only if no secrets, private financial data, screenshots, or account identifiers are committed.
- Product: security-first financial dashboard for viewing and interacting with eToro API data.
- Implementation has not started; this is a scaffold and planning state.
- Official eToro API documentation must be verified before implementing live API behavior.
- Default feature posture is read-only. Trading and account mutation features must stay disabled until explicitly designed, audited, and feature-gated.
- Do not work directly on `master` or `main`; create/use a scoped branch and merge completed deliverables into `develop`.
- `master` is release/promotion only and requires explicit user direction.

## Read Next

- `AGENTS.md` for non-negotiable AI coding and security rules.
- `docs/memory/security.md` for threat model and financial-app controls.
- `docs/memory/architecture.md` before choosing or changing app architecture.
- `docs/memory/etoro-api.md` before implementing eToro calls.

## Commands

- `npm run check`: placeholder until app stack is selected.

## Open Decisions

- Choose app stack. Recommended default: TypeScript + Next.js or another server-capable web stack, with all eToro API calls server-side.
- Confirm whether this dashboard is read-only only, or whether order/trading actions are in scope later.
- Confirm authentication model for dashboard users if it will be accessible beyond the local machine.
