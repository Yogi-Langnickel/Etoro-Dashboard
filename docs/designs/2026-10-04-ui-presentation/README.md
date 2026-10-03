# Portfolio presentation pass

Open [the approved-direction mock](index.html). This is one visual baton for the
user-approved presentation pass, not a choice of alternatives. All values,
identities and dates are invented; production never imports them.

- Compact header: Environment, Display currency, Refresh data, System health
  and one plain Real/Demo read-only status.
- One visible actionable freshness/error banner; partial and unknown coverage
  stay visible. Refresh data is the action for stale/expired or recoverable reads;
  Connection details is only for authorization/configuration problems. Health
  contains precise clocks, retries, source reasons and audit. The mock's generic
  Details command is replaced with these contextual actions in production.
- Four unchanged money KPIs with plain footers and visible indicative FX basis.
- Supporting cash/concentration statistics above the full-width holdings table.
- Search/coverage and sort/order form separate control groups; 25-row pagination.
- On-demand native instrument dialog, closed on initial selection. Asset click,
  Enter/Space or the visible details command opens it. Escape/Close return focus;
  profile/tab changes close it. Only one modal may be open at a time.
- Native prices/quantities retain precision and evidenced denomination. Missing
  portfolio cells use a compact dash with an accessible plain reason, not zero.
- Secondary text is larger and brighter; numeric columns use right alignment
  and tabular figures. No unavailable future context tiles in the primary view.

Tradeoff: details take one deliberate action, leaving more space for holdings.
Synthetic viewport and real native 200% zoom proof must verify the implementation,
including modal containment, focus return and all financial/status distinctions.
No API, authentication, dependency or formatting contract changes are included.

## Mock acceptance and implementation evidence

The primary visually inspected synthetic desktop 1440px and mobile 375px mocks.
Measured document width equals viewport width at 375/768/1440px, dialogs initially
closed. Native inspector opening/focus/Escape/return to ALFA passed at desktop
and mobile. The mobile small-price, signed-rate and fractional-quantity facts fit.
The primary accepted this direction; these are mock results, not product proof.

Developer implemented-browser proof passed 55 synthetic assertions, preserving
financial precision, conversion, retained stale coverage and the three tabs while
checking full-width holdings, missing-cell reasons and native dialog interaction.
The measured secondary body copy is 14px and native facts 16px. Baseline muted
colors already met the measured contrast pairs; this is a density/typography
improvement, not an escaped contrast incident or full WCAG certification.
Primary iteration 1 passed 261 full tests, 55 synthetic browser assertions and
15 actual native 200% zoom checks (factor 2, CSS viewport 720, CSS zoom 1).
Primary inspected implemented desktop/mobile and native inspector/Health images.
Viewport CDP capture uses captureBeyondViewport:false without a scrolled clip;
all 15 assertions were repeated after that ephemeral capture correction.
Both full iteration 1 reviews completed. Pending-retry precedence and FX display
range feedback, plus currency conflict wording, are addressed with regressions.
Corrected primary passed 263 full tests, 55 synthetic browser assertions and
15 actual native zoom checks. Both complete iteration 2 reviewers accepted all
11 Dashboard/7 canonical files with no remaining findings; financial review
passed 53 tests and QA/governance 120. All required/optional iteration 1 feedback
is addressed. Primary safety/audit0/diff/nine-file Markdown lint passed and compact
memory is 141 lines. Implementation is approved; mechanical Git integration and
publication remain with the primary closeout, with no future SHAs claimed.
All screenshots remain ephemeral under /private/tmp with the presentation prefix;
production contains no fixture values. Git publication evidence belongs to the
primary closeout.
