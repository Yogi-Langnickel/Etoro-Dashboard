# eToro Dashboard Portfolio And Bot Tab Options

Date: 2026-06-02

These are static, synthetic design mocks for the next practical dashboard pass.
They are not implementation files and do not contain private account data,
provider payloads, account identifiers, or real balances.

Open:

- `index.html`
- `desktop-preview.png`
- `mobile-preview.png`
- `full-page-desktop.png`
- `full-page-mobile.png`

## Baseline Used

- Two top-level tabs: Portfolio View and Bot Control.
- Portfolio View uses a three-column operating model:
  portfolio tree/list, rich selected-asset workspace, and automated-action
  context.
- Portfolio rows aggregate multiple open positions by instrument.
- Enrichments are context-only: fundamentals, risk, valuation, financials,
  insider activity, and news. They do not create recommendations or trade
  triggers.
- Bot Control shows simulation/backtest controls, safety posture, strategy
  selection, budgets, cadence, audit, and run history. Execution remains locked
  unless a separate reviewed design approves it.

## Options

- Option 1, Split Workbench: closest to the requested 25/55/20 layout. Dense,
  familiar, fastest to implement from the current dashboard.
- Option 2, Ledger Inspector: table-first, light operational style with a
  spreadsheet-like instrument ledger and a stronger selected-asset inspector.
- Option 3, Command Deck: status-strip and workflow-first layout for repeated
  daily operation, with bot controls presented as guarded procedures.
- Option 4, Research Console: asset dossier centered, better for enrichment
  review and thesis tracking, less ideal for very fast position scanning.
- Option 5, Bot Operations Bay: bot control gets the strongest visual hierarchy,
  while portfolio remains an input surface. Best when Money-maker becomes the
  main daily workflow.

## Inspection Notes

- Each option includes a Portfolio View screen and a Bot Control screen.
- Values are fictional and deliberately generic.
- Color palettes are intentionally different in mood but not merely color swaps;
  each option changes structure, density, and workflow emphasis.
