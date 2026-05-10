# Architecture Notes

Status: active
Last updated: 2026-05-10

## Initial Direction

Recommended architecture:

- TypeScript web application with server-side routes for eToro API calls.
- UI consumes typed internal DTOs, not raw eToro responses.
- eToro client is isolated behind a server-only module.
- All API responses are validated and normalized before rendering.
- Mutation-capable API calls are separated from read-only calls and feature-gated.
- Local static servers expose only explicit public assets; backend modules and source files are not static content.

## Suggested First Milestones

1. Select stack and scaffold app.
1. Add server-only eToro client shell with credential loading and redacted errors.
1. Add read-only health/check endpoint.
1. Add watchlist and instrument lookup views.
1. Add portfolio snapshot view.
1. Add market data charts.
1. Add audit logs and export controls.
1. Only then evaluate trading actions.
