# Security Policy

Etoro Dashboard is security-sensitive because it may read financial account data and may eventually support trading or order actions through the eToro API.

## Reporting

Do not file public issues with eToro API credentials, user keys, OAuth tokens, account identifiers, portfolio data, balances, screenshots, exports, or exploit details. Report sensitive findings privately to the project owner.

## Baseline Rules

- Never commit `.env`, API keys, user keys, OAuth tokens, refresh tokens, cookies, private account identifiers, portfolio exports, brokerage statements, or screenshots with private balances.
- Keep all eToro credentials and privileged API calls server-side.
- Store local demo credentials outside the repository, preferably at `${HOME}/.config/etoro/credentials.json` with `chmod 600`.
- Default to read-only behavior.
- Do not durably store account-linked dashboard data. Live read-only provider
  data may be normalized server-side and protected by short in-memory
  cache/backoff metadata, but portfolio exports, balances, holdings, position
  ids, order ids, transaction history, raw provider payloads, and
  reconciliation records must not be persisted in this repo without a new
  storage review.
- Keep trading, order placement, order cancellation, copy-trading, and account mutation disabled unless explicitly designed, feature-gated, confirmed, audited, and tested against a safe environment.
- Validate and normalize every eToro API response before UI use or persistence.
- Redact authorization headers, credentials, account identifiers, holdings, balances, and transaction details from logs and errors.

## Before Public Push Or Release

- Run `npm audit --audit-level=moderate`.
- Run `npm run safety:public` to reject tracked and untracked non-ignored
  environment/credential files, private account artifacts, unreviewed binary
  files, private keys, and high-confidence credential literals while allowing
  explicit synthetic test fixtures and reviewed public design assets.
- Run `npm run check`.
- Review `git diff` for secrets, private financial data, screenshots, reports, and private fixtures.
- Confirm `.env.local`, private exports, private reports, and screenshots are not staged.
