# FairLab — Final CSD Presentation & Viva Defense Guide

> **Course:** Computer Systems Design (CSD) · IIT Bhilai  
> **System:** FairLab — Fairness-Aware Workstation Booking & Allocation System for Lab L-106 (`84` Workstations)  
> **Release:** `v1.0.0` (`14/14` Automated Test Suites · `76/76` Acceptance Assertions Verified)

---

## Part 1: Recommended 12-Slide Presentation Outline (10–12 Minutes)

### Slide 1 — Title & Problem Statement
- **Title:** FairLab: Fairness-Aware Workstation Booking & Physical Access Control for IIT Bhilai Lab L-106
- **Core Problem:** Traditional FIFO lab booking rewards fastest-clickers and automated refresh scripts, causing severe starvation during exam/deadline peaks while offering no physical gate verification or academic timetable awareness.
- **Scale:** 84 workstations across Block A (`6×10 = 60`) and Block B (`4×6 = 24`), supporting custom `[start, end)` intervals and configurable institutional policies.

### Slide 2 — Requirements & System Boundaries
- **Functional:** 84-seat live map, custom intervals (`30 min` – `2 h`), ranked 1–3 workstation preferences, hybrid immediate/fairness allocation, HMAC QR gate check-in/out, Mon–Fri academic timetable, holidays/extra days, admin ticket releases, maintenance auto-reallocation, semester resets.
- **Non-Functional:** Zero double-booking under concurrency, zero client-trusted identity in production, crash-safe real-time updates, auditability.
- **Explicit Scope Boundary:** Software core is fully implemented and verified; institutional SSO (Google Workspace OAuth/LDAP), physical turnstile relays, and NVIDIA-SMI workstation agents are cleanly decoupled future integrations.

### Slide 3 — High-Level Architecture (Modular Monolith)
- Show the layered modular monolith diagram from `FAIRLAB_FINAL_HLD_LLD.md`:
  - **Client:** 15-screen React 18 + Vite + Tailwind SPA + WebSocket real-time subscriber.
  - **API & Auth Layer:** Express REST (`/api/v1`) + Zod v4 validation + HS256 JWT / `HttpOnly` cookie middleware + 2-role + `ACCESS_OPERATOR` RBAC + sliding-window rate limiter.
  - **Domain Services:** Booking & Hybrid Allocation, Fairness Engine, Availability & Schedule/Timetable/Ticket Engine, HMAC QR Pass & Gate Verification, Maintenance Reallocator, Analytics.
  - **Persistence:** SQLite WAL (local dev/tests) & PostgreSQL 16 (production) + Transactional Outbox (`outbox_events`).
- **Why a Modular Monolith?** Fits Lab L-106 scale cleanly on a single `10 vCPU / 10 GB RAM` campus VM (`~86 MB` idle Node RSS measured) with ACID transactions instead of distributed-consensus overhead.

### Slide 4 — Database Design & Hard Invariants
- **Half-Open Intervals `[start, end)`:** Back-to-back bookings (`10:00–11:00` and `11:00–12:00`) never falsely collide; overlap condition is `start_a < end_b AND start_b < end_a`.
- **Database-Level Overlap Protection (Not Just App Checks):**
  - PostgreSQL 16: `btree_gist` `EXCLUDE USING gist` constraint rejecting any concurrent overlapping seat write with SQLSTATE `23P01`.
  - SQLite WAL: Atomic `BEFORE INSERT` / `BEFORE UPDATE` triggers enforcing the identical invariant.
- **Separation of Concerns:** Hard DB invariants vs configurable institutional policies (`policy_config`, `lab_timetable`, `lab_date_overrides`, `ticket_releases`).

### Slide 5 — Hybrid Allocation & Anti-Bypass Concurrency Control
- **Two Modes, One Transaction Rule:**
  1. **Uncontested (`IMMEDIATE`):** If no allocation round is `RUNNING` and no competing `QUEUED` request overlaps `[start, end)`, immediately confirm the student's highest-ranked free preference inside one DB transaction.
  2. **Contested (`SCHEDULED`):** Otherwise, queue the request for deterministic fairness allocation.
- **Critical Concurrency Fix:** The competing-request check and running-round check execute **inside the same database transaction (`immediateTx`)** as the booking insert — preventing simultaneous `AUTO` submissions from bypassing the fairness queue.

### Slide 6 — Fairness Scoring & Starvation Mitigation
- **Priority Formula:**
  $$P_u = \max\bigl(P_{\min},\; B - r_{\text{norm}} \cdot T_u - r_{\text{peak}} \cdot T_H - \text{Penalties}\bigr)$$
  Default policy: $B = 100$, $P_{\min} = 10$, $r_{\text{norm}} = 5\text{ pts/hr}$, $r_{\text{peak}} = 10\text{ pts/hr}$ (when $\text{DemandRatio} > 1.5$), No-Show $= -25\text{ pts}$, Voluntary Cancel $= 0\text{ pts}$.
- **4-Tier Deterministic Tie-Breaking:**
  1. `priority_score` DESC
  2. `cumulative_wait_seconds` DESC *(starvation-mitigation mechanism among equal-priority users under sustained contention)*
  3. `requested_at` ASC
  4. `request_id` ASC
- **Semester Reset:** Archives historical scores/bookings intact while starting every student fresh at `100` points next term.

### Slide 7 — Security Architecture (Zero-Trust Identity & Scoped RBAC)
- **Authentication:** `@iitbhilai.ac.in` institute login → server issues signed HS256 JWT + `HttpOnly; SameSite=Lax` cookie (`Secure` in `NODE_ENV=production`). Constant-time HMAC verification (`crypto.timingSafeEqual`) + expiry check.
- **Zero Client Trust:** In `NODE_ENV=production`, `x-user-id` is strictly ignored (`401`) across all route groups, and demo endpoints (`/auth/switch-user`, `/auth/users`) return `403`.
- **2-Role + Permission Model:** Strictly `student` and `admin`. Gate operations (`POST /api/access/check-in`, `/check-out`) require `admin` **plus** the scoped `ACCESS_OPERATOR` permission — keeping ordinary faculty admins separated from physical gate actions.
- **QR Gate Security:** Zero-PII token `FAIRPASS:<bookingId>:<hmac16>`, single-use state machine (`VALID → CHECKED_IN → USED`), replay attempts immediately denied (`ALREADY_CHECKED_IN`).

### Slide 8 — Reliability: Transactional Outbox & Crash Recovery
- Booking confirmations and allocation rounds write `PENDING` rows to `outbox_events` inside the **same ACID transaction**.
- Events publish immediately post-commit, on **server startup recovery**, and via a **5-second background sweep**, carrying deterministic `eventId` tags.
- **At-Least-Once Delivery Handling:** If the server suffers a hard `SIGKILL` after WebSocket broadcast and before marking `PUBLISHED`, restart recovery redelivers the same `eventId`; the frontend WebSocket consumer (`SocketContext.jsx`) deduplicates recent deliveries via a bounded 500-entry `Set`, while backend state mutations remain idempotent via `Idempotency-Key` and DB constraints.

### Slide 9 — UI/UX & Institutional Operations (15 Live Screens)
- Student Workspace (5 views): Dashboard, 84-Seat Map & Custom Booking (with live timetable/holiday/ticket availability banner), My Bookings & QR Pass, Fairness Score Ledger, Notifications.
- Admin Workspace (9 views): Overview, Allocation Round, Schedule & Tickets (Mon–Fri timetable, holidays, ticket releases), Workstations (maintenance auto-reallocation, honest `—` telemetry), Students, Analytics, Access Control, Settings, Audit Log.

### Slide 10 — Verification & Simulation Results (Measured vs Estimated)
- **Measured Test Results:**
  - `14 / 14` automated test suites passing (`node tests/run-all-tests.js`).
  - `76 / 76` Phase 10 acceptance assertions passing (`test-phase10-validation.js`, `2.4s`), including 6-student simultaneous `Promise.all` race, live `NODE_ENV=production` security checks, and hard `SIGKILL` outbox recovery.
  - `100` simultaneous requests vs `5` seats (`test-concurrency.js`): `0` duplicates, `~170 ms`.
  - PostgreSQL 16 live tests (`test-postgres.js`, `test-app-on-postgres.js`): `23P01` exclusion enforced.
  - `14` adversarial red-team vectors (`test-adversarial-redteam.js`): JWT tamper, `ACCESS_OPERATOR` `403`, IDOR, SQLi/XSS, rate-limit `429`.
- **Deterministic 50-Seed Fairness Simulation (`Seed 1337`):** Under bot-latency skew, Gini drops from `0.657` (FIFO) to `0.022` (FairLab) and Jain's Fairness Index rises from `0.252` to `0.998`.
- **Capacity Estimates (Clearly Labeled as Projections):** Local idle footprint measured at `~86 MB` Node RSS & `308 KB` JS bundle; projected `500–2,000` campus users / `~3.5 GB` peak RAM on a `10 vCPU / 10 GB RAM` VM (requires formal k6 load testing before SLA certification).

### Slide 11 — What Is Implemented vs. What Is Planned (Credibility Slide)

| Implemented & Verified (`v1.0.0`) | Planned / Future Institutional Rollout |
| :--- | :--- |
| Student / Admin HS256 JWT + `HttpOnly` cookie auth (`@iitbhilai.ac.in`) | IIT Bhilai Google Workspace OAuth (`hd=iitbhilai.ac.in`) / LDAP SSO |
| Hybrid fairness booking + Mon–Fri timetable + holidays + tickets | Official institute ERP / academic timetable sync |
| Zero-PII HMAC-SHA256 QR verification & `ACCESS_OPERATOR` gate RBAC | Physical Lab L-106 turnstile relay integration (`RELAY_CONTROLLER_URL`) |
| Shared **SQLite WAL** live persistence (`fairlab-api-1` + `fairlab-api-2` on 1 VM) | Full async **PostgreSQL 16** runtime cutover for multi-host scaling |
| Cross-replica WebSocket event propagation (`431 ms` measured via outbox tailer) | Multi-host horizontal deployment (with Redis Pub/Sub if needed) |
| Honest GPU telemetry reporting (`—`, zero synthetic data) | Live NVIDIA-SMI telemetry agents installed on L-106 PCs |
| Private campus VM HTTP deployment (`http://10.1.75.40:3500`) | HTTPS TLS termination at Nginx for untrusted networks |

### Slide 12 — Live Demonstration (8-Step Flow on `http://10.1.75.40:3500`)
- Follow the exact 8-step flow in `local_prep/DEMO_WALKTHROUGH.md` directly on `http://10.1.75.40:3500` & `http://10.1.75.40:7500`.

---

## Part 2: Anticipated Professor Viva Questions & Crisp, Defensible Answers

### Q1: "Does your fairness algorithm mathematically guarantee starvation freedom?"
**Answer:**
> We intentionally do **not** claim an unconditional formal proof of starvation freedom. Instead, eligible waiting-time accumulation acts as a **starvation-mitigation mechanism**: among users with equal priority scores (including users who hit the priority floor $P_{\min} = 10$), waiting time accumulates across waitlisted rounds and breaks ties in favor of users who waited longer. Under sustained contention and the defined eligibility assumptions (valid quota, non-maintenance seats), this promotes waiting students, which we verified empirically across our 50-seed benchmark (`0.0%` starvation vs heavy FIFO skew).

### Q2: "What prevents two students from booking the exact same seat at the exact same millisecond?"
**Answer:**
> Defense in depth at two layers. First, `submitHybridBookingRequest` executes the contention check (`runningRound` and competing `QUEUED` count) and the `INSERT INTO bookings` inside a single atomic database transaction (`immediateTx`). Second, even if two concurrent transactions raced in PostgreSQL, the database itself enforces a half-open `[start, end)` `EXCLUDE USING gist` constraint (`23P01`), and SQLite enforces matching `BEFORE INSERT` overlap triggers. Double-booking is impossible at the storage layer.

### Q3: "How do you prevent a student from spoofing another user's ID or an admin's privileges?"
**Answer:**
> In `NODE_ENV=production`, FairLab completely ignores any client-supplied `x-user-id` header and disables demo account switching (`/auth/switch-user`, `/auth/users` return `403`). Every protected route resolves identity strictly from a server-signed HS256 JWT (`Authorization: Bearer`) or `HttpOnly; SameSite=Lax; Secure` cookie verified with `crypto.timingSafeEqual`, then re-loads the user's authoritative role and permissions from the database. Modifying the JWT payload invalidates the signature (`401`).

### Q4: "Checking `@iitbhilai.ac.in` doesn't prove I actually own that email address—how do you address that?"
**Answer:**
> Completely agreed. Checking the `@iitbhilai.ac.in` suffix only filters out non-institute domains at the login boundary; it does not prove mailbox ownership on its own. For campus production deployment, the login verification step is designed to be replaced with IIT Bhilai Google Workspace OAuth (`hd=iitbhilai.ac.in`) or institutional LDAP/SSO while keeping the downstream JWT/session/RBAC pipeline unchanged.

### Q5: "Why did you remove the Watchman role and make `ACCESS_OPERATOR` a permission instead?"
**Answer:**
> Keeping strictly two application roles (`student` and `admin`) simplifies the core RBAC model while avoiding a second security trap: giving *every* admin (such as a course professor who only runs allocation rounds) access to physical gate check-in/out. Scoping gate endpoints behind `role === 'admin' && permissions.includes('ACCESS_OPERATOR')` enforces least privilege cleanly—verified in our tests where `Prof. Sneha` gets `403` at the gate while `Ram Singh (Gate Desk)` is authorized.

### Q6: "What happens if your server crashes right after sending a WebSocket notification and before marking the outbox event `PUBLISHED`?"
**Answer:**
> That is an at-least-once delivery scenario. On restart, the server's startup recovery sweep sees the row is still `PENDING` and redelivers it with the exact same deterministic `eventId`. On the client, `SocketContext.jsx` tracks recent `eventId`s in a bounded 500-entry `Set` and drops duplicates so UI notifications don't fire twice. Crucially, the bounded client `Set` is only for UI responsiveness—all state-changing backend operations remain idempotent via `Idempotency-Key` and database uniqueness/exclusion constraints.

### Q7: "Are those GPU telemetry stats on your dashboard real NVIDIA-SMI metrics?"
**Answer:**
> No, and we explicitly refuse to fake them. Because we do not have hardware agents installed on physical L-106 workstations yet, hardware telemetry is cleanly separated from booking availability. The UI displays `—` with an explicit disclaimer that NVIDIA-SMI telemetry agents are planned future work.

### Q8: "You tested on SQLite—how do you know PostgreSQL 16 actually works?"
**Answer:**
> Our master test suite includes two dedicated live PostgreSQL 16 suites (`tests/test-postgres.js` and `tests/test-app-on-postgres.js`) that execute against a real PostgreSQL 16 instance, verifying schema creation, `btree_gist` half-open overlap rejection (`23P01`), concurrency, and fair allocation invariants.

### Q9: "Why are 2-hour max duration, timetable blocks, and ticket releases separate from the fairness formula?"
**Answer:**
> Because fairness scoring is a mathematical allocation rule, whereas maximum booking duration (`2h`), daily quota (`2h/day`), concurrent active booking limits, Mon–Fri academic lab classes, holiday overrides, and ticket release caps are **configurable institutional policies**. Keeping them in dedicated admin-managed tables lets the lab coordinator adjust schedules for exams or holidays without modifying the fairness engine.

