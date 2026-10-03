# Etoro Dashboard

Security-first dashboard for viewing and interacting with eToro API data.

## Status

The local read-only dashboard keeps eToro credentials server-side, exposes
normalized selected-profile Real/Demo portfolio and default-watchlist views to the browser, resolves
market symbols by verified exact match, batches current-rate reads, and loads
selected-period close-price charts. The three tabs are Portfolio View,
Watchlist Items and Bot Control. The server briefly caches provider responses
and applies short failure backoff; the browser lazy-loads inactive tabs.
Provider execution routes remain absent.

Browser watchlist and market DTOs never include provider instrument, watchlist,
price-rate, account, position, or order identifiers. Partial rate failures and
failed chart reads remain explicit; the browser does not silently substitute
fixture charts for failed provider market data.

The workspace environment selector applies to Portfolio, Watchlist, market
charts, and descriptive Statistics. Switching profiles clears account-linked
state and invalidates pending requests. Same-profile last-good rows may remain
visible after a failed refresh, explicitly marked stale. Missing credentials,
authentication rejection, provider failures, empty data and partial coverage
remain distinct; a configured profile rejected with HTTP 401 is not described
as unconfigured.

Statistics reuse the selected portfolio snapshot. Cash percentage divides
available cash by positive equity. Largest holding ranks displayed instruments
by instrument margin and divides by provider total used margin in v1; omitted
or incomplete holdings may change that ranking. Direct, copy/mirror cash and
frozen pending-order scopes are disclosed separately. Invested capital is not complete leveraged
risk exposure. Instrument price history is not portfolio return history;
historical performance, drawdown and dividends remain unavailable without the
required evidence.

The dashboard does not durably store account-linked provider data. Short
in-memory cache/backoff metadata is allowed for freshness and rate-limit
protection; account-linked history belongs in a separately reviewed
Money-maker worker store if it is needed later.

Research Desk financial-record context includes a fixture-backed SEC
companyfacts normalizer. It exposes normalized coverage fields only and keeps
live SEC fetching blocked until a server-side cache/rate-limit policy and SEC
User-Agent contact value are configured.

## Portfolio Completeness And Display Currency v1

The v1 implementation uses matching Real/Demo aggregate-portfolio reads
for full account totals and instrument aggregates, plus v2 instrument-breakdown
for supported native prices and position fields. Both use
conversionMode=eToroApp. Real aggregate accepts matching read OR write; Demo
aggregate and both breakdowns require matching read. Their provider times remain separate; the composite
response is not an atomic snapshot. Instrument margin, liquidation value, P/L,
signed exposure and net units/contracts retain distinct meanings. Direct
holdings, copy holdings, mirror cash and frozen pending-order amounts do not
silently collapse into one scope.

Fields are independently available. Missing return cannot hide known margin;
missing current native price cannot hide units or a supported opening rate. Why
missing explains field-level omissions, invalid types, scopes, ambiguity,
overflow and mixed-direction/zero-net semantics. Signed provider opening rates are direction-aware net rates, used only with
appropriate evidence. Combined-copy and known zero relevant net rates stay unavailable; nonzero futures
contracts and missing quantities alone do not erase independently supplied rates; no naive
mixed-position average is invented. The
raw provider ROE scale is contradictory in the specification; displayed P/L % is
independently derived from validated return and positive margin.
Zero-denominator percentages remain unavailable.

Metadata resolution uses bounded 100-ID batches through 500 instruments with
global ambiguity checks. Later instruments are covered; snapshots beyond the
supported boundary and unresolved metadata remain visibly incomplete. Optional
metadata authorization failures preserve validated values with explicit degraded
identity. Omitted copy collections remain unknown, and manual mirrorId=0 data is
quarantined. Source clocks without an explicit zone are null with reasons; they
do not hide usable totals. Exported details cap at 1000 per row while counts and
consistency use all validated source positions.

Display currency is a labelled native select beside Environment, defaulting to
the evidenced account currency. The server's public ECB reference-rate adapter
provides one validated EUR-basis snapshot. Supported account-money fields
convert consistently using target-rate/source-rate; original amounts remain
intact. Counts, quantities, percentages and native prices/charts are unchanged.
Show account/display currency, indicative basis and publication date, with
currency-specific minor units. Unsupported, stale or unavailable FX stays
explicit; portfolio and FX freshness are separate. Currency changes do not read
each holding. Statistics include independently known account balance, frozen
pending cash and mirror cash. Unknown native denomination is explicitly labelled;
portfolio currency never establishes candle currency. Currency/FX repaint preserves
stale portfolio status and refresh restores scoped selection/focus.

The compact Portfolio workspace places four money cards, visible indicative FX
basis, partial/unknown coverage and collapsible cash statistics above full-width
holdings. Local pagination starts at 25 rows. Open a holding by click, Enter,
Space or the visible details command; its native dialog contains price/position
facts and chart periods. Initial selection leaves the dialog closed. Escape or
Close returns focus to the current scoped row or a visible fallback. Profile/tab
changes close details; the three established tabs and generation guards remain.

A plain Portfolio data banner distinguishes snapshot freshness, current-read
failure and FX availability. Refresh data retries recoverable reads; Connection
details opens System health for authorization/configuration problems. There is
no new authentication action. System health holds precise clocks, retry metadata,
technical field reasons/sources and the read audit. Partial/unknown coverage stays
visible outside it. Missing table/inspector cells use a dash with accessible plain
reasons, including missing conversion; source amounts and precision are unchanged.

Current field contracts, action owners and input/completion gates are reached
through the [Dashboard canonical context pointer](unblockme.md). Follow its
verified workspace bootstrap and returned projectMemory directory for the current
API notes, implementation plan, design review and dated validation. The older
repo-local docs links are compatibility paths and may point to another branch;
they do not establish current contracts. The portable [design
baton](docs/designs/2026-10-04-ui-presentation/README.md) remains here. The earlier
[v1 baton](docs/designs/2026-10-04-portfolio-completeness-v1/README.md) is historical.
Actual test/live acceptance and publication states are recorded in canonical validation; offline
success does not establish live parity. Money Maker's separate research blockers
are not blanket Dashboard blockers. No collection/training or producer change is
included.

## Official eToro API Reference

The current source of truth is the [eToro Developer Portal](https://api-portal.etoro.com/),
its [documentation index](https://api-portal.etoro.com/llms.txt), and the
[Agent Skill landing page](https://api-portal.etoro.com/core/ai-agents/etoro-skill).
As rediscovered through the official MCP catalog on 2026-10-04, the API identifies
version `v1.383.0` and Agent Skill version `1.21.0`.
Its MCP server is `https://mcp.public-api.etoro.com`.

Those references do not authorize MCP installation, credential use, provider
requests, persistence, or trading. Never paste credentials into chat. For a
separately authorized future integration, discover the current tags, route,
specification, scopes, rate-limit group, and deprecation/replacement from the
official catalog. Use exactly one authentication mode: the
`x-api-key`/`x-user-key` pair or OAuth Bearer authentication, never both.

The current server's `/api/v1` paths and pinned base URL are dated local
implementation contracts, not current route authority; the applicable official
operation may have a replacement or use `v2`.

### Market-data clarifications received 2026-10-03

The owner supplied an eToro support clarification on this date; the sender's
message date was not supplied. The following operational notes paraphrase that
clarification. The official catalog was also checked without executing provider
reads: the v1 market-data routes below remain listed without deprecation, and
v2 routes coexist. Rediscover the current specification for future changes.

- Search may omit `instrumentType` and `instrumentTypeID` even when projected.
  If classification is needed, obtain `instrumentTypeID` from
  `GET /api/v1/market-data/instruments?instrumentIds={instrumentId}` and map it
  through `GET /api/v1/market-data/instrument-types`. The dashboard's current
  symbol resolver does not classify instruments from search results.
- Search can return related symbols. Compare the returned `internalSymbolFull`
  exactly with the requested canonical symbol; `SPY.RTH` and `SPY5.L` cannot
  substitute for `SPY`. Omitted exact matches and ambiguous rows fail closed.
- Explicitly projecting `instrumentId` can produce the same JSON property twice
  with equal values. These are one identifier on one result, not two instruments.
  Equal repeated properties are the provider-confirmed and regression-tested
  case. The normal JSON parser retains the last repeated property's value and
  does not detect conflicting duplicate properties. Multiple exact result rows
  remain ambiguous and fail resolution independently of repeated properties.
- Current prices come from
  `GET /api/v1/market-data/instruments/rates?instrumentIds={instrumentId}`:
  `bid`, `ask`, `lastExecution`, and ISO 8601 UTC `date`. Candle history uses
  `GET /api/v1/market-data/instruments/{instrumentId}/history/candles/{direction}/{interval}/{candlesCount}`;
  its `fromDate` is the candle start in ISO 8601 format. Market timestamps must
  include an explicit timezone and valid calendar date; the dashboard normalizes
  accepted instants to UTC. Timestamp format does not establish a trading session
  calendar or an exchange-close convention.
- The rates/candle contract does not define listing currency, a separate price-basis
  flag, corporate-action adjustments, a historical retention period, or rights to
  retain data for model use. Do not infer any of them from a symbol, instrument
  type, conversion rate, successful read, or timestamp. An ETF type alone also
  does not establish product exposure or research suitability. Those matters
  require separate evidence before retained research collection or model use.

Currency evidence is route-specific. Explicit portfolio/breakdown assetCurrency
can support those native financial fields. It does not establish historical
candle/rates currency, session, price basis or research eligibility. Market chart
prices remain in their evidenced units, without an unsupported currency marker.
Account totals and instrument margin/liquidation/P/L retain their documented
account currency and are separate from native prices.

## Contract Boundaries

- `src/server.mjs` owns HTTP dispatch, static allowlisting, and local mutation
  controls; `src/market-views.mjs` composes exact-symbol watchlist, rate, and
  chart DTOs behind that boundary.
- `src/provider-read-cache.mjs` owns credential-separated in-memory caching,
  request coalescing, bounded provider backoff, and public error redaction.
- `src/browser-contracts.js` validates and derives portfolio, watchlist, and
  chart values before `src/app.js` renders them. `src/browser-fixtures.js`
  separately owns synthetic tab data. Neither bundle contains provider
  requests or credentials, and both load before the renderer.
- `src/synthetic-fixture.mjs` owns the explicit fixture watermark shared by
  planning-only server DTOs. `src/planning-status.mjs` owns the synthetic bot,
  risk, and research status composition. Server modules are never statically
  served.
- `src/trade-preview.mjs` owns non-executing ticket validation and preview
  policy; `src/server.mjs` retains local request checks, bounded body parsing,
  and response dispatch. No provider mutation is introduced by this split.

## Local Real/Demo Credentials

Do not paste eToro keys into chat or commit them to the repo. Store your read-only named profiles at `${HOME}/.config/etoro/credentials.json`.

The workspace uses explicit named profiles. A normal server reads no repo-local `.env` file and never sends credentials to the browser.

The file declares the official base URL, a `real` or `demo` default, and a `profiles` object. Each configured profile contains its server-only eToro public API key and environment-specific user key. Create the containing directory with mode `0700` and the file with mode `0600`. Either profile may be omitted; an absent profile is shown as **not configured**. There is no fallback to the other profile. The following values are synthetic placeholders, not usable credentials:

The exported `migrateLegacyRealProfile` helper is deliberately value-blind. Use it only with the owner-only legacy source, preserve an existing differing profile, then run the normal-server Real identity, P&L, and portfolio smoke checks. Call its explicit source-removal callback only after those checks and a normal `npm run start` browser smoke succeed. Do not print, hash, or paste either source or destination value.

```json
{
  "baseUrl": "https://public-api.etoro.com",
  "defaultEnvironment": "demo",
  "profiles": {
    "real": {
      "publicApiKey": "SYNTHETIC_REAL_PUBLIC_API_KEY",
      "userKey": "SYNTHETIC_REAL_READ_USER_KEY"
    },
    "demo": {
      "publicApiKey": "SYNTHETIC_DEMO_PUBLIC_API_KEY",
      "userKey": "SYNTHETIC_DEMO_READ_USER_KEY"
    }
  }
}
```

Set user-only permissions:

```sh
mkdir -p "${HOME}/.config/etoro"
chmod 700 "${HOME}/.config/etoro"
chmod 600 "${HOME}/.config/etoro/credentials.json"
```

Run locally:

```sh
npm run start
```

For fixture-only browser or Playwright checks, use the capability-denying
offline launcher. It ignores ambient eToro credentials and traps provider
fetches:

```sh
npm run start:offline
```

Then open `http://localhost:4173`. The app also accepts `ETORO_CREDENTIALS_FILE` if you want a different credential path.

Generic read routes accept one `environment=real|demo` parameter and otherwise
use `defaultEnvironment` (overridable with `ETORO_DEFAULT_ENVIRONMENT`). Explicit
`/api/etoro/demo/*` read routes always use Demo and reject a conflicting
environment. Invalid or repeated environment parameters fail closed. Browser
requests always send the selected environment. Cache, coalescing and failure
backoff are separated by profile and credential-file generation.

The server is intentionally loopback-only. Setting `HOST` to a LAN or public
address fails closed because account-linked portfolio and watchlist reads do
not yet have an authentication or secure-session boundary.

Set `ENABLE_DEMO_TRADE_PREVIEW=true` only when you want the local server to validate and preview demo tickets. Preview responses are redacted and still do not place orders.

Set `ETORO_READ_CACHE_TTL_MS` if local read-only provider calls need a different short success-cache window. The default is `15000` milliseconds and the maximum is `300000` milliseconds. Provider 429, timeout, and 5xx failures are negative-cached for a short server-memory backoff so repeated local refreshes do not storm the provider.

Bot configuration at `${HOME}/.config/etoro-dashboard/bot-config.json` contains
saved draft preferences. Saving strategy, budget or cadence choices does not
reconfigure the approved diagnostic runner. PUT accepts the complete exact typed
contract, including the fixed `minimumEvaluationIntervalMinutes: 240`, and
rejects unknown fields, numeric strings and supplied `updatedAt`. Configuration
metadata stays pinned to the existing generated Money Maker contract.

### Isolated offline diagnostics

Bot Control runs the actual Money Maker engine on the approved synthetic SPY
fixture. Its fixed slow-trend strategy, USD 1,000 allocation and budget, USD 100
reserve and USD 250 order limit come from the unchanged approved manifest. The
202-event diagnostic has no investment-profit evidence, provider calls,
credentials, account data, orders or training. It uses a separate Dashboard
state root and never attaches to an installed worker or scheduler.

Install the reviewed producer runtime once from a checkout containing commit
`c17248ce097c3ed03e1e262be972023f48e63636`:

```sh
node scripts/setup-offline-runtime.mjs /absolute/path/to/Money-maker-3000
npm run start:offline
```

Setup copies only pinned Git blobs, ignoring dirty checkout files, and verifies
all 42 committed source, contract and fixture files. It preserves the complete
committed fixture inventory and never regenerates contracts. The private
runtime lives at
`${HOME}/.local/share/etoro-dashboard/money-maker/c17248ce097c3ed03e1e262be972023f48e63636`
with files mode `400` and directories mode `500`. Private operational files live
separately at `${HOME}/.local/share/etoro-dashboard/offline-diagnostics` with
files mode `600` and directory mode `700`. Missing, changed or extra runtime
files, symlinks, hardlinks and unsafe private state fail closed.

The fixed bridge uses Python 3.11 or newer: `/usr/local/bin/python3.13` on macOS,
`/usr/bin/python3` on Linux. It runs with isolated imports, no site hooks, a
minimal credential-free environment, a 20-second deadline and a 2 MB combined
output limit. A missing interpreter or runtime leaves controls unavailable.
Every invocation rechecks runtime provenance before importing producer code.

`GET /api/etoro/bot/operations` reports actual operational state, lease and ledger
integrity, diagnostic reasons, counts and the report observation time. Its
30-second observation expiry is independent of the producer's 48-hour ledger
age policy; the ledger report's fixed `generatedAt` is never freshness evidence.
`GET /api/etoro/bot/capabilities` exposes one versioned adapter; future
capabilities remain unavailable. Bot API audit/event feeds contain actual,
bounded session events, and restart with an empty session history.

Run once, block and re-enable use `POST /api/etoro/bot/operations` with the exact
body `{action, operationId}`. Actions are `run-once`, `block` or `reenable`, and
the operation ID is a UUID v4. Each accepted operation retains its original
`startedAt` in the private journal; retrying the same ID confirms the existing
completion instead of appending another ledger record. Pending occurrences may
need the producer's 300-second lease to expire before recovery. The bounded
journal retains up to 256 operations and refuses further new identities at
capacity. A first read initializes the adapter journal only in a pristine private root.
Keep the private journal, lease and ledger together: an established root with a
missing journal refuses status and all actions without recreating identities or
changing retained state. Deletion or corruption requires deliberate recovery.
Latest diagnostic veto reasons come from that occurrence's matching ledger
record; attempts blocked before completion do not inherit earlier run vetoes.

Blocking runs engages the producer kill switch and fences subsequent
completion. It does not terminate a subprocess or control a background
scheduler. An operation already completed before the block remains completed.
All mutations require the exact local HTTP Origin and Host (including port),
JSON content type, and the `x-etoro-dashboard-csrf` request header carrying the
token from `x-etoro-dashboard-config-token` on a config or operations read.
Authoritative producer state is read back before action success is returned.

For disposable browser validation, the offline launcher accepts only server
operator environment overrides for isolated files:

```sh
DASHBOARD_OFFLINE_RUNTIME_ROOT=/private/verified/runtime \
DASHBOARD_OFFLINE_STATE_ROOT=/private/isolated/state \
DASHBOARD_OFFLINE_CONFIG_FILE=/private/isolated/bot-config.json \
npm run start:offline
```

Browser requests cannot select executables, scripts, strategies, fixtures,
filesystem paths or allocation parameters. The offline launcher continues to
deny eToro credentials and provider access.

## Goals

- View portfolio, watchlist, market, and social-trading data through official eToro API endpoints.
- Keep credentials and privileged API calls server-side.
- Treat trading actions as opt-in, audited, and feature-gated.
- Keep demo trade execution disabled until the ticket, confirmation, audit, and order-status flow are implemented.
- Keep historical market-data/backtest work in Money-maker ahead of portfolio
  persistence, reconciliation records, or demo execution.
- Keep the repository safe to publish publicly by never committing secrets or private financial data.

## Current Recommendation

Start with a read-only dashboard:

1. API health and credential validation.
1. Portfolio snapshot and P/L views.
1. Read-only default watchlist, exact instrument lookup, and batched rates.
1. Selected-period market charts.
1. Audit-safe export/reporting.
1. Trading actions only after read-only flows, security checks, and confirmation UX are stable.

## Security

Prefer `${HOME}/.config/etoro/credentials.json` for local credentials. `.env.local` is ignored by Git but is not loaded by the normal server. Do not commit real `.env` files or credential JSON files.

Credential rules and AI coding instructions live in `AGENTS.md`. Repository security policy lives in `SECURITY.md`.

Incident review and durable bug-learning workflow lives in `docs/incidents/README.md` and `docs/memory/bug-learning.md`. New incident and qualifying bug lessons include transferability notes so the orchestrator can promote broadly useful learnings to workspace memory or affected repositories.

## Validation And Producer Portability

Run `npm run check`, `npm run safety:public`, `npm audit --audit-level=moderate`
and `git diff --check`. The current `typecheck` command performs JavaScript
syntax checking, not static type checking. Use `npm run start:offline` for
synthetic browser, error and race checks; it denies provider access despite
ambient credentials. Live acceptance uses the normal server and reports only
redacted assertions, without retained financial screenshots, traces or responses.

Generated Money-maker schema, immutable provenance and artifact SHA-256 checks
are mandatory, including in standalone checkouts. Optional producer verification
reads the committed artifact at the exact pinned producer revision through Git;
it does not import Python, inspect arbitrary working-branch code, regenerate
contracts or modify Money-maker. The default location is the sibling
`Money-maker-3000`; select a relocated or linked worktree explicitly:

```sh
MONEY_MAKER_PRODUCER_CHECKOUT=/absolute/path/to/producer npm run contract:check
```

A missing checkout or absent pinned revision reports the optional check as
unavailable while mandatory artifact checks still run. A wrong repository
origin, missing artifact at an available pinned revision, or hash mismatch fails
closed. Dirty working files and the checked-out branch do not replace immutable
provenance. Verification performs no fetches and does not claim that the current
producer implementation was rebuilt or tested.
