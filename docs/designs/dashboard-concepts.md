# eToro Dashboard Design Reset

Status: second review draft  
Created: 2026-05-28  
Supersedes: first draft with `Loss Lab`, `Narrative Ledger`, and `Triage Control`

The first design round was rejected because the concepts felt too similar and
too much like professional finance workstations. This reset deliberately moves
away from dark terminals, dense queues, KPI cards, and risk-lab framing.

All concepts remain read-only. They avoid trading actions, investment advice,
account identifiers, exact balances, screenshots, raw provider payloads, private
exports, and browser-side credentials. Enrichment is treated as source context,
similar to Stock Analyst receipts, not as a signal or recommendation.

## Designer Concepts

### Option 1: Glasshouse Atlas

A bright observatory for source conditions. Markets, research coverage,
provider health, and simulated bot telemetry appear as transparent climate
layers inside a glasshouse.

- First screen: a full-screen atlas with zones for portfolio shape, research
  coverage, market context, provider health, and simulation monitor.
- Visual language: daylight, frosted panes, fine grid etching, organic contour
  lines, coverage blooms, and explicit source badges.
- Interactions: lens toggles for freshness, coverage, provider posture, and
  simulation state; click any zone to inspect receipts and redaction posture.
- Strength: most transparent and source-aware.
- Risk: can become abstract if the map metaphor hides plain personal status.

### Option 2: Portfolio Planetarium

A private financial observatory. Holdings and watchlist names appear as bodies
in an orbital model, with evidence records as small moons.

- First screen: an interactive orrery where orbit bands represent asset class
  or theme, ring clarity represents enrichment completeness, and glow indicates
  recent context changes.
- Visual language: calm observatory canvas, muted starfield grid, ivory labels,
  teal source rings, and amber freshness warnings.
- Interactions: zoom from the whole system into one instrument, compare two
  bodies by normalized attributes, and open evidence moons as receipts.
- Strength: most visually memorable.
- Risk: may be too decorative or abstract for a personal account front door.

### Option 3: Soundings

A portfolio as a nautical depth chart. Holdings are islands and shoals;
concentration is a reef line; stale data is fog; freshness is a tide ruler.

- First screen: one large sea map using CSS/SVG-style shapes, not cards or
  tables. Holdings are sized by relative exposure bucket, not exact balance.
- Visual language: off-white chart paper, muted sea blue, ink labels, rust risk
  boundaries, pale green verified-source marks, and gray fog for stale data.
- Interactions: hover an island for plain status, click into a harbor view,
  scrub freshness with a tide ruler, and toggle source overlays.
- Strength: clearest creative break from the rejected finance-terminal feel.
- Risk: needs plain labels so it remains useful and not just a metaphor.

## Non-Specialist Review

A reviewer who is not a designer or finance professional evaluated the reset
brief. Their acceptance rubric:

| Area | Weight | What must be true |
| --- | ---: | --- |
| Immediate understanding | 25% | In 10 seconds, the user can tell whether the dashboard is demo or real, read-only, fresh or stale, and what needs attention. |
| Trust and restraint | 25% | No trading nudges, no hidden scores, visible sources, timestamps, fixture/live state, missing data, and privacy posture. |
| Creative distance | 20% | It must not feel like another dark, dense risk command center with renamed panels. |
| Plain language | 15% | Normal-person labels first. Expert terms only in drilldown. |
| Enrichment handling | 15% | Enrichment appears as receipts, never advice, prediction, signal, or recommendation. |

Automatic rejects: buy/sell/hold implications, unclear demo/real mode, unclear
read-only status, unexplained account numbers, stale data presented as current,
or enrichment framed as what the user should do.

## Council Proposal

Recommended direction: **Personal Soundings**.

Use `Soundings` as the base because it is calm, plain, personal, and readable
as observation rather than action. Borrow only the useful parts of `Glasshouse
Atlas`: transparent source visibility, clear receipts, and redaction posture.
Do not use `Portfolio Planetarium` as the primary direction; it is memorable,
but risks feeling abstract and less useful as the first screen.

The product should feel like a private read-only account log:

- What changed?
- What source says it?
- How fresh is it?
- What context is attached?
- What is missing?

It should not feel like a trading terminal, signal engine, command center, or
advice product.

## Council Review Options

### 1. Personal Soundings Recommended

A calm dashboard journal with a map-like account surface. First screen shows
read-only status, demo/real mode, freshness, plain observations, and
receipt-backed context.

Use for the next implementation if the goal is a personal, non-intimidating
dashboard.

### 2. Glasshouse Ledger

A transparency-first view focused on provenance, cache state, provider status,
redaction, and how each displayed fact is known.

Use if compliance clarity and auditability should dominate the first screen.

### 3. Plain Atlas

A simple map of account areas: portfolio, sources, research, risk, bot monitor,
and provider health. Less metaphor, more navigation.

Use if the dashboard needs a clear front door before adopting a stronger visual
metaphor.

## Implementation Acceptance Criteria

- Global header always shows `Read-only`, `Demo` or `Real`, provider connection
  state, last successful refresh, and stale/cache state.
- No UI affordance implies trading: no buy, sell, close, copy, rebalance,
  recommend, execute, optimize, or best-move language.
- Every metric, row, map item, chart, and enrichment card shows source and
  freshness: fixture/live, provider/public-record/RSS/synthetic, retrieved time,
  or unavailable state.
- Enrichment appears as receipts: source name, record type, retrieved time,
  coverage state, conflict/missing-data state, and context-only framing.
- Demo/real visibility never exposes account IDs, position IDs, exact balances,
  raw provider payloads, credentials, screenshots, or private exports.
- Empty, stale, rate-limited, fixture, provider-offline, and partial-data states
  are explicitly designed.
- Copy stays plain and personal: `Needs review`, `Source missing`, `Fresh`,
  `Stale`, `Fixture`, `Read-only`. Avoid finance-insider language on the first
  screen.
- Existing tabs can remain, but the first screen should become a calmer
  overview/log rather than a dense trading cockpit.
- Validation should include `npm run check` plus UI review for read-only
  labeling, fixture/source labels, stale states, absent trading controls, and no
  advice copy.

The accompanying static design board is at
`docs/designs/etoro-dashboard-concepts.html`.

Additional visually distinct option mocks are at
`docs/designs/etoro-dashboard-six-directions.html`.
