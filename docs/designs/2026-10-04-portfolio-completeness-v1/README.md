# Portfolio completeness v1 design baton

This is one synthetic operational direction for the explicitly requested implementation. Open [the visual mock](index.html). Every amount, symbol and chart in this folder is invented design data; it is never imported by Portfolio View.

- Keep the existing restrained dark palette and three tabs.
- Use a compact toolbar with labelled native Environment and Display currency selects.
- Use four monetary KPIs: equity, available cash, used margin and unrealized P/L. Put counts, omissions, provider freshness and FX basis in a compact coverage strip.
- Give the holdings table the wider column. Primary fields are Asset, Margin / invested, Liquidation value, P/L, P/L % and Coverage. Use 25-row local pagination with explicit counts and stable selection.
- Give selected instrument details a bounded inspector. Show independent native prices, opening rate, units, position count, source scope and field-level missing reasons. Keep chart controls inside the chart.
- Below 950px, move the inspector ahead of the table. Also provide a direct inspector link so mobile users never traverse every row to find details.
- Allow horizontal scrolling inside the table only; financial values must remain readable without truncation. KPI amounts wrap rather than clip. Panels and charts never stretch with holding count.
- Preserve keyboard row selection, focus, reduced motion, search, stable sorting, coverage filtering and Real/Demo generation guards.
- Convert account money through one validated FX snapshot. Keep quantities, percentages and native prices unchanged; show account/display currencies, indicative ECB basis and rate date. Stale or missing FX remains explicit.

Root accepted this direction before implementation. Primary offline synthetic
browser validation passed 45 assertions at 375px, 768px and 1440px, equivalent
200% CSS viewport/CSS zoom reflow, keyboard and computed reduced-motion suppression.
Earlier toolbar shortcuts did not alter managed Chromium zoom. A later disposable
Chromium profile and temporary loopback-only extension verified actual native
200% zoom through chrome.tabs.setZoom/getZoom: factor 2, physical viewport 1440px,
CSS viewport 720px and CSS zoom 1. Six native-zoom assertions passed, including
unclipped cards/table cells, no horizontal overflow, mobile inspector-first layout
and keyboard inspector focus. Corrected CDP physical 1440×1800 capture was visually
inspected after the stale-caption repair: both money columns, wrapping controls,
visible mobile inspector and accurate retained-coverage/current-failure text.
All data and retained media were synthetic. Both full iteration 4 personas
accepted the unchanged design and complete scope with no remaining findings;
actual publication evidence belongs to primary closeout.

Iteration 1 corrections preserve this direction: balance/frozen/mirror cash in
Statistics, explicit source-clock/copy/metadata/detail gaps, full-source semantics
behind bounded detail, and reason-based unresolved identity. Account-first and
FX-first completion share the account-based default unless a user preference
overrides it; scoped refresh focus and synchronous freshness are regression-tested.
