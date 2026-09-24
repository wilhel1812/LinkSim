# Security Policy

## Supported Versions

LinkSim is under active development. Security fixes are applied to the latest `main` branch.

## Reporting a Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Report privately by emailing:

- `wilhelm.francke@gmail.com`

Include:

- A clear description of the issue
- Steps to reproduce
- Affected endpoints/features
- Any proof-of-concept details

## Response Expectations

- Initial response target: within 72 hours
- Triage and fix timeline depends on severity and reproducibility
- Coordinated disclosure is preferred after a fix is available

## Automated Alert Triage

The repository maintainer owns alerts from GitHub CodeQL and secret scanning.

- Review new alerts in the repository Security tab and validate their impact before assigning severity or opening public tracking work.
- For a suspected exposed credential, do not copy the value into issues, pull requests, comments, or logs. Revoke or rotate it first, then reference only the GitHub alert and affected location in remediation records.
- For CodeQL findings, confirm the reachable source-to-sink path and affected runtime before fixing or dismissing the alert. Record a concise rationale for any dismissal.
- Keep `npm run security:scan` in local and CI verification as a fast tracked-file guard; GitHub secret scanning provides the complementary history-aware and push-protection coverage.

## Scope Notes

- Cloudflare account configuration (Access policies, API tokens, DNS) is environment-specific and out of repository scope, but reports about insecure default guidance in docs are welcome.
