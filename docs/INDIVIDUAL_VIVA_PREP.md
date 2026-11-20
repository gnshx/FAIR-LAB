# FairLab — Individual Viva Preparation Guide (Individual Marking)

> **Author & Developer:** NDS Ganesh  
> **Roll Number:** BT23CSE001  
> **Degree & Department:** M.Tech in Computer Science and Engineering, IIT Bhilai  
> **Official Email:** ganesh.k@iitbhilai.ac.in  
> **Key Rule from Panel:** *"After the demo, we would ask questions regarding the implementation of the project. Marking will be individual."*

As the sole author and developer of FairLab, you have complete end-to-end command of the entire architecture, implementation, and deployment down to exact file names, SQL constraints, and line-level logic.

---

## 1. Full-Stack Module Ownership & Architecture

| Architectural Layer | Modules & Subsystems Built | Key Source Files |
| :--- | :--- | :--- |
| **Fairness Allocation Engine** | Dynamic priority formula ($P = \max(10, 100 - 5T - 8H)$), 3-tier deterministic tie-breaking, hybrid immediate-versus-fairness queueing, starvation-free virtual round-robin at floor saturation | `backend/services/fairnessEngine.js`, `backend/services/bookingService.js`, `tests/benchmark-fairness-50seeds.js` |
| **Frontend & UI/UX** | 15-Screen responsive React 18 SPA, 84-seat interactive floor map (Block A 6x10 + Block B 4x6), custom `[start, end)` time intervals, live WebSockets, mobile navigation drawer, React Error Boundary | `frontend/src/views/WorkstationMapView.jsx`, `frontend/src/views/AdminScheduleView.jsx`, `frontend/src/components/ErrorBoundary.jsx`, `frontend/src/context/SocketContext.jsx`, `frontend/src/context/AuthContext.jsx` |
| **Security & Gate Access** | Server-signed HS256 JWT + `HttpOnly; SameSite=Lax; Secure` cookie auth, strictly 2-role RBAC (`student`, `admin`) with scoped `ACCESS_OPERATOR` gate permission, zero-PII HMAC-SHA256 QR passes, anti-replay check-in/out | `backend/middleware/auth.js`, `backend/routes/auth.js`, `backend/routes/access.js`, `backend/services/passService.js`, `backend/services/verificationService.js`, `backend/services/gpuResourceService.js` |
| **Database & Invariants** | SQLite WAL with `BEGIN IMMEDIATE` + PostgreSQL 16 `btree_gist` non-overlap exclusion triggers, Transactional Outbox pattern, audit log preservation, semester rollover | `backend/db/database.js`, `backend/db/sqlite.js`, `backend/db/postgres.js`, `backend/db/postgres-schema.sql` |
| **Campus VM Ops & Infra** | Nginx reverse proxy + least-connections load balancer, dual PM2 instances, WebSocket cross-replica fan-out tailer, systemd services on Ubuntu 24.04 (`10.1.75.40`) | `nginx/fairlab.conf`, `ecosystem.config.js`, `scripts/deploy-campus-vm.sh` |
| **Master Test Suite** | 16 automated test suites covering concurrency (100 req vs 5 slots), 14 red-team attack vectors, 50-seed Monte Carlo Gini simulation, and headless Chrome browser validation | `tests/run-all-tests.js`, `tests/test-concurrency.js`, `tests/test-adversarial-redteam.js`, `tests/test-frontend-views-resilience.js` |

---

## 2. Core Must-Know Facts (Quick Defense Cheat Sheet)

1. **Lab Inventory:** Lab L-106 has **84 physical workstations** = Block A (`6 rows × 10 = 60`, `L106-PC-01..60`) + Block B (`4 rows × 6 = 24`, `L106-PC-61..84`).
2. **Half-Open Interval Math:** Every reservation uses half-open intervals `[start, end)`. Two intervals overlap if and only if `start_a < end_b AND start_b < end_a`. Therefore, `10:00–11:00` and `11:00–12:00` do **NOT** overlap.
3. **Fairness Formula (Active Institutional Policy):**
   $$P_u = \max\bigl(10,\; \operatorname{round}(100 - 5 \cdot T_u - \text{Penalties}_u)\bigr)$$
   - `T_u` = total completed hours (`5 pts/hr` deduction).
   - Voluntary cancellation = **`0` penalty**; Confirmed No-Show (>15m grace) = **`+5` penalty pts** (reduces $P_u$ by 5) + automatic waitlist promotion.
   - Tie-break order: `Priority Score DESC → Cumulative Waiting Time DESC → Timestamp ASC → Request ID ASC`.
   - Phrasing: *"Waiting-time accumulation provides a starvation-mitigation mechanism among equal-priority users under sustained contention."*
4. **Why Contention Check Is Inside `immediateTx`:** Checking `runningRound` and competing `QUEUED` requests *inside the same ACID transaction* as `INSERT INTO bookings` prevents simultaneous `AUTO` requests from bypassing fairness.
5. **Auth & RBAC Model:**
   - **2 roles ONLY:** `student` and `admin`.
   - Gate check-in/check-out requires `role === 'admin'` **AND** permission `ACCESS_OPERATOR`. Ordinary admins (`ssen@iitbhilai.ac.in`) get `403`.
   - In `NODE_ENV=production`, `x-user-id` is strictly ignored (`401`), `/auth/switch-user` and `/auth/users` return `403`, and missing `JWT_SECRET`/`HMAC_SECRET` refuses startup.
6. **Pass Token Format:** `FAIRPASS:<bookingId>:<hmac16>` signed with server-side `HMAC_SECRET`. Contains **zero PII**, cannot be forged, and re-scan after check-in returns `ALREADY_CHECKED_IN` (`authorized: false`).
7. **Cross-Replica Sync:** Transactional Outbox pattern. An event is written to `outbox_events` in the same database transaction as the booking; the outbox tailer publishes it over WebSockets every second across PM2 replicas.

---

## 3. High-Probability Panel Defense Questions & Bulletproof Answers

### Q1: "How do you guarantee that two students cannot book the same seat at the same time?"
> **Answer:**
> We enforce concurrency control at three distinct layers:
> 1. **Application Layer:** Inside an immediate transaction (`BEGIN IMMEDIATE`), we execute `isWorkstationBusyForWindow(machineId, date, start, end)` evaluating the mathematical overlap condition `start_a < end_b AND start_b < end_a`.
> 2. **Database Invariant Layer:** In SQLite, an active `BEFORE INSERT` trigger aborts conflicting inserts. In PostgreSQL 16, a `btree_gist` exclusion constraint (`EXCLUDE USING gist (machine_id WITH =, tsrange(start_time, end_time) WITH &&)`) enforces physical serialization at the storage engine level.
> 3. **Verification:** Validated under high load in `tests/test-concurrency.js` where 100 simultaneous requests for 5 workstations resulted in exactly 5 unique allocations with zero duplicate seats.

### Q2: "Why didn't you just use FIFO like BookMyShow or IRCTC?"
> **Answer:**
> In an academic GPU lab during submission deadlines, FIFO leads to severe starvation: bot scripts and fast clickers monopolize 100% of seats, leaving regular students with 0 hours. Our 50-seed Monte Carlo benchmark proved that under bot-skew, FIFO produces a Gini inequality of $0.657$, while FairLab reduces Gini inequality to $0.022$ and raises Jain's Fairness Index to $0.998$.

### Q3: "What happens if the server crashes right after allocating a seat?"
> **Answer:**
> We use the **Transactional Outbox pattern**. The booking record and the outbox event (`booking.confirmed`) are committed atomically in the same database transaction. If the node crashes immediately after commit, the WAL ensures the data is intact. Upon restart, the outbox processor sweeps un-emitted events and publishes them over WebSockets, guaranteeing at-least-once delivery with client-side deduplication.

### Q4: "What happens when multiple heavy users hit the 10-point minimum floor?"
> **Answer:**
> When multiple saturated users reach the floor ($P_{\min} = 10$), the system seamlessly transitions from score-based priority to a **starvation-free virtual round-robin** via Tier 2 tie-breaking: `cumulative_wait_seconds DESC`. The student who has waited the longest in queue automatically wins the next available seat.
