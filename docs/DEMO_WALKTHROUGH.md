# FairLab — Live Demonstration Script & Architecture Walkthrough

> **Target System:** FairLab · Fairness-Aware Workstation Booking & Allocation System  
> **Lab Scope:** IIT Bhilai · Computer Lab L-106 (84 Workstations: Block A `6×10` + Block B `4×6`)  
> **Status:** Phase 10 Validated Baseline (`14/14` Automated Test Suites · `71/71` Phase 10 Assertions Passing)

---

## 1. Quick-Start: Clean Reproducible Launch

To demonstrate FairLab from a **100% clean database state**, run:

```bash
# 1. Remove any prior local SQLite state (clean-slate verification)
rm -f backend/fairlab.db backend/fairlab.db-shm backend/fairlab.db-wal

# 2. Build production frontend bundle (if modified)
cd frontend && npm run build && cd ..

# 3. Start FairLab (auto-creates schema, seeds 84 workstations, timetable, tickets & personas)
cd backend && node server.js
```

Expected startup output:
```text
[Seed] Populating FairLab database with IIT Bhilai L-106 (84 systems: Block A 6x10 + Block B 4x6)...
[Seed] Seeding completed successfully (84 workstations, 9 configurable hourly slots 09:00-18:00)!
====================================================
FairLab API running on http://0.0.0.0:5000
WebSocket server active for real-time seat map & queue
IIT Bhilai · Computer Lab L-106 (84 Workstations: Block A 6x10 + Block B 4x6)
Serving Frontend at http://0.0.0.0:5000/
====================================================
```

Open **`http://localhost:5000`** in Chrome/Firefox.

### Reproducible Automated Verification (1-Command Proof)

Run all 14 test suites (including PostgreSQL 16, 100-request concurrency, 14 red-team attacks, 50-seed fairness benchmark, production JWT/cookie mode, and outbox crash recovery):

```bash
node tests/run-all-tests.js
```

Or run the standalone **Phase 10 Final Validation Suite** (`71` assertions, ~1.8s, isolated temp DB):

```bash
node tests/test-phase10-validation.js
```

---

## 2. Demo Accounts (Strictly 2 Roles + Scoped Permissions)

Every login requires an `@iitbhilai.ac.in` account and issues a signed **HS256 JWT** (`Authorization: Bearer`) plus an **`HttpOnly; SameSite=Lax`** session cookie (`Secure` in `NODE_ENV=production`).

| Persona | Email | Role | Permissions | Starting Score | Best Demo Use |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Priya Sharma** | `priya.s@iitbhilai.ac.in` | `student` | `[]` | `100` | Fresh student winning contested allocation |
| **Ganesh Kumar** | `ganesh.k@iitbhilai.ac.in` | `student` | `[]` | `90` | Active booking, QR pass & voluntary cancel |
| **Rahul Verma** | `rahul.v@iitbhilai.ac.in` | `student` | `[]` | `80` | Mid-tier competing request |
| **Ananya Patel** | `ananya.p@iitbhilai.ac.in` | `student` | `[]` | `70` | Lower-score student submitting earlier than Priya |
| **Dr. A. K. Sharma** | `aksharma@iitbhilai.ac.in` | `admin` | `POLICY_ADMIN`, `ALLOCATION_ADMIN`, `ACCESS_OPERATOR` | — | Full lab coordinator (timetable, tickets, maintenance, allocation, gate) |
| **Prof. Sneha Sen** | `ssen@iitbhilai.ac.in` | `admin` | `ALLOCATION_ADMIN` | — | Proves ordinary admin is **blocked (`403`)** from gate check-in/out |
| **Ram Singh (Gate Desk)** | `accessdesk.l106@iitbhilai.ac.in` | `admin` | `ACCESS_OPERATOR` | — | Designated L-106 gate operator for QR check-in/check-out |

*(In dev/demo mode, any non-empty password signs in a seeded `@iitbhilai.ac.in` persona; non-institute domains like `user@gmail.com` are rejected with `403 INVALID_EMAIL_DOMAIN`.)*

---

## 3. Timed Demonstration Tracks

### Track A — 3-Minute Executive Demo (Core Value Proposition)

1. **0:00 – 0:45 · Login & 84-Seat Map**:
   - Attempt login with `student@gmail.com` → show instant **`403`** domain enforcement.
   - Sign in as **Priya Sharma (`priya.s@iitbhilai.ac.in`)** → open **Lab Seat Map**.
   - Highlight Block A (`6×10 = 60`) + Block B (`4×6 = 24`) = **84 workstations** and live availability for custom `[start, end)` intervals (max 2h institutional policy).
2. **0:45 – 1:45 · Hybrid Booking + Anti-Bypass Fairness**:
   - Book an uncontested Saturday window (`10:00–11:00`) → **immediately `CONFIRMED`** inside one atomic transaction with a **signed HMAC-SHA256 QR pass**.
   - Show that when competing requests exist for the same window, even an `AUTO` request is atomically routed into the **Fairness Queue** (`SCHEDULED`) — no fairness bypass is possible.
   - Switch to **Dr. Sharma (`aksharma@iitbhilai.ac.in`)** → run an **Allocation Round** → show **Priya (score 100)** winning her #1 seat preference ahead of **Ananya (score 70)** even though Ananya submitted first.
3. **1:45 – 3:00 · Physical Gate Verification & Score Accounting**:
   - Switch to **Gate Desk (`accessdesk.l106@iitbhilai.ac.in`)** → scan/verify Priya's QR token → **`ENTRY_AUTHORIZED`** → **Check-In**.
   - Re-scan the exact same QR token → **`DENIED`** (single-use anti-replay).
   - **Check-Out** → booking transitions to `COMPLETED`, workstation freed, and Priya's fairness score deducts deterministically (`100 → 95`).

---

### Track B — 5-Minute CSD Evaluation Demo (Adds Admin Policy & RBAC)

Run Track A, then add:

4. **3:00 – 4:00 · Institutional Schedule Controls (Timetable, Holidays & Ticket Releases)**:
   - As **Dr. Sharma**, open **Admin → Schedule & Tickets**.
   - Show Mon–Fri academic lab timetable blocks (e.g., CS305 / DS204 automatically blocking student self-booking during class labs).
   - Show Holiday / Extra-Day Overrides and Admin Ticket Release windows.
5. **4:00 – 5:00 · Maintenance Auto-Reallocation & Scoped RBAC Proof**:
   - Toggle a booked workstation to **Maintenance** → demonstrate automatic zero-downtime reallocation of active bookings to healthy seats.
   - Demonstrate **2-Role + Permission separation**: show that **Prof. Sneha (`admin` without `ACCESS_OPERATOR`)** receives `403` on `/api/access/check-in`, while **Ram Singh (`admin` + `ACCESS_OPERATOR`)** is authorized.

---

### Track C — 10-Minute Deep Technical & Security Walkthrough

Run Track B, then open a terminal and execute:

```bash
# Live verification of all 71 Phase 10 checks (including NODE_ENV=production & Outbox Crash Recovery)
node tests/test-phase10-validation.js
```

Walk the evaluator through the live terminal output:
- **V1 (Clean DB)**: 84 seats, Block A/B, 2-role schema, timetable & tickets verified from an empty file.
- **V2 (Student Journey)**: `JWT_BEARER` + `SESSION_COOKIE`, immediate confirmation, idempotency replay, HMAC QR check-in, replay block, check-out deduction, and 0-penalty voluntary cancellation.
- **V3 (Anti-Bypass Fairness)**: Atomic contention check inside `immediateTx` blocks `AUTO` bypass; highest fairness score wins rank #1 regardless of submission timestamp.
- **V6 (Live `NODE_ENV=production` Hardening)**:
  - Refuses startup without `JWT_SECRET`/`HMAC_SECRET`.
  - Sets `HttpOnly; SameSite=Lax; Secure` on login and clears with `Secure` on logout.
  - Rejects spoofed `x-user-id: usr-admin-sharma` with `401` across auth, bookings, fairness, and admin routes.
  - Disables `/api/auth/switch-user` and `/api/auth/users` (`403`).
- **V7 (Crash Recovery & At-Least-Once Idempotency)**:
  - Kills the server, injects a `PENDING` event into `outbox_events`, restarts the server, and proves startup recovery publishes it (`PUBLISHED`) with a deterministic `eventId` deduplicated by the WebSocket consumer (`SocketContext.jsx`).

---

## 4. Architecture Walkthrough — Key Design Decisions & Rationale

Use these concise explanations when defending the system design:

| Design Choice | Why We Made It | Where to Point in Code |
| :--- | :--- | :--- |
| **Modular Monolith** (Node.js + Express + WS + SQLite WAL / PostgreSQL 16) | Lab L-106 serves ~84 seats and ~500–2,000 campus users. A modular monolith eliminates distributed transaction complexity while fitting comfortably on a single 10 vCPU / 10 GB RAM campus VM (~86 MB RSS idle measured). | [`backend/server.js`](../backend/server.js), [`backend/services/`](../backend/services/) |
| **Half-Open Intervals `[start, end)` + DB-Level Overlap Protection** | Half-open intervals allow back-to-back bookings (`10:00–11:00` and `11:00–12:00`) without off-by-one conflicts. Enforcing non-overlap in SQLite triggers and PostgreSQL `EXCLUDE USING gist` guarantees zero double-booking even under concurrent writes. | [`backend/db/database.js`](../backend/db/database.js), [`backend/db/postgres/schema.sql`](../backend/db/postgres/schema.sql) |
| **Signed HS256 JWT + `HttpOnly` Cookie (Zero-Trust Identity)** | Never trusts client-provided `x-user-id` in production (`NODE_ENV=production`). User ID, role, and permissions are derived strictly from the verified JWT/cookie and re-checked against the DB. | [`backend/middleware/auth.js`](../backend/middleware/auth.js), [`backend/routes/auth.js`](../backend/routes/auth.js) |
| **2 Application Roles + `ACCESS_OPERATOR` Permission** | Keeps the role model simple (`student`, `admin`) while enforcing least-privilege separation so ordinary faculty admins cannot operate physical gate check-in/out without the explicit `ACCESS_OPERATOR` permission. | [`backend/middleware/auth.js`](../backend/middleware/auth.js#L204-L220), [`backend/routes/access.js`](../backend/routes/access.js) |
| **Atomic Hybrid Allocation (Contention Check Inside Transaction)** | Uncontested requests confirm immediately for UX; contested requests enter the fairness queue. Checking for active rounds & competing `QUEUED` requests *inside the same DB transaction* as booking insertion prevents simultaneous requests from bypassing fairness. | [`backend/services/bookingService.js`](../backend/services/bookingService.js#L427-L450) |
| **Fairness Formula + Waiting-Time Tie-Breaker** | $P_u = \max(P_{\min}, B - r_{\text{norm}} T_u - r_{\text{peak}} T_H - \text{Penalties})$. Under sustained contention, eligible waiting-time accumulation promotes students who waited longer among equal-priority users (starvation-mitigation mechanism), and voluntary early cancellation incurs zero penalty. | [`backend/services/fairnessEngine.js`](../backend/services/fairnessEngine.js) |
| **Transactional Outbox + Idempotent WebSocket Consumer** | Outbox events are committed atomically inside the booking/allocation DB transaction (`PENDING`), published on commit/startup/5s sweep with a deterministic `eventId`, and deduplicated client-side (`seenEventIdsRef`) so at-least-once crash redelivery never causes duplicate UI actions. | [`backend/services/bookingService.js`](../backend/services/bookingService.js#L1292-L1325), [`frontend/src/context/SocketContext.jsx`](../frontend/src/context/SocketContext.jsx) |
| **Configurable Institutional Policies Separated from DB Invariants** | 30-min minimum, 2-hour max duration, 2-hour daily quota, Mon–Fri timetable blocks, holidays, and ticket release caps live in configurable tables (`policy_config`, `lab_timetable`, `lab_date_overrides`, `ticket_releases`) rather than hardcoded fairness math. | [`backend/services/scheduleService.js`](../backend/services/scheduleService.js) |

---

## 5. Production Deployment Verification Checklist

Before deploying on the IIT Bhilai campus VM (`10 vCPU / 10 GB RAM`), confirm:

1. Copy `.env.example` to `.env` and populate fresh 256-bit secrets (`openssl rand -hex 32`) for `JWT_SECRET` and `HMAC_SECRET`.
2. Set `NODE_ENV=production` and `CORS_ORIGIN=https://<your-campus-domain>`.
3. Serve behind HTTPS reverse proxy (Nginx/Caddy) so `Secure` session cookies transmit cleanly over TLS.
4. Integrate institutional SSO (Google Workspace OAuth with `hd=iitbhilai.ac.in` or IIT Bhilai LDAP/CAS) to cryptographically verify mailbox ownership beyond domain-suffix checks.
5. Run PostgreSQL 16 schema (`backend/db/postgres/schema.sql`) and verify `node tests/test-postgres.js` and `node tests/test-app-on-postgres.js`.
