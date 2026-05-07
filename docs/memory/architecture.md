# Architecture Notes

Status: active
Last updated: 2026-05-07

## Initial Direction

Recommended architecture:

- TypeScript web application with server-side routes for eToro API calls.
- UI consumes typed internal DTOs, not raw eToro responses.
- eToro client is isolated behind a server-only module.
- All API responses are validated and normalized before rendering.
- Mutation-capable API calls are separated from read-only calls and feature-gated.

## Suggested First Milestones

1. Select stack and scaffold app.
2. Add server-only eToro client shell with credential loading and redacted errors.
3. Add read-only health/check endpoint.
4. Add watchlist and instrument lookup views.
5. Add portfolio snapshot view.
6. Add market data charts.
7. Add audit logs and export controls.
8. Only then evaluate trading actions.

