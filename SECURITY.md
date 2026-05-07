# Security Policy

Etoro Dashboard is security-sensitive because it may read financial account data and may eventually support trading or order actions through the eToro API.

## Reporting

Do not file public issues with eToro API credentials, user keys, OAuth tokens, account identifiers, portfolio data, balances, screenshots, exports, or exploit details. Report sensitive findings privately to the project owner.

## Baseline Rules

- Never commit `.env`, API keys, user keys, OAuth tokens, refresh tokens, cookies, private account identifiers, portfolio exports, brokerage statements, or screenshots with private balances.
- Keep all eToro credentials and privileged API calls server-side.
- Default to read-only behavior.
- Keep trading, order placement, order cancellation, copy-trading, and account mutation disabled unless explicitly designed, feature-gated, confirmed, audited, and tested against a safe environment.
- Validate and normalize every eToro API response before UI use or persistence.
- Redact authorization headers, credentials, account identifiers, holdings, balances, and transaction details from logs and errors.

## Before Public Push Or Release

- Run `npm audit --audit-level=moderate`.
- Run the project validation gates once the app stack is selected.
- Review `git diff` for secrets, private financial data, screenshots, reports, and private fixtures.
- Confirm `.env.local`, private exports, private reports, and screenshots are not staged.

