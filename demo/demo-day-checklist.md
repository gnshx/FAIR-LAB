# Demonstration Day Checklist

## Before leaving

- [ ] Laptop, charger, and any required adapter.
- [ ] Confirm campus Wi-Fi/network and live demo URL: <http://10.1.75.40:3500/>.
- [ ] Sign in once with the prepared student account; verify any admin account separately if showing it.
- [ ] Confirm the selected demo date/time has useful availability and the seat legend is visible.
- [ ] If showing live updates, prepare a second browser/session and a safe, reversible demo action.
- [ ] Keep `architecture.md`, `walkthrough.md`, and this checklist available offline.
- [ ] Save screenshots of actual current UI as fallback; label Figma images as mockups.
- [ ] Keep a short recording or local environment ready only if permitted by course rules.
- [ ] Ensure no personal data, passwords, SSH details, database credentials, or secrets appear in slides/screenshots.

## During demo

- [ ] Explain goal and user roles briefly.
- [ ] Show availability for a chosen time interval and read the actual UI legend.
- [ ] Demonstrate a normal booking using prepared demo data.
- [ ] Explain HTTP request vs WebSocket live event; show a second-client update only if observed.
- [ ] Describe race handling: server revalidation plus DB constraints/transaction.
- [ ] Show architecture and clarify SQLite is live; PostgreSQL is isolated evaluation only.
- [ ] Answer questions honestly; distinguish implemented, tested, and planned features.

## Before finishing

- [ ] Do not leave an unwanted active booking or altered admin policy behind; clean up only through intended UI and demo account.
- [ ] Do not run stress tests or attack scripts against the hosted VM during the panel.
- [ ] Thank panel and be ready to explain individual contributions and limitations.

