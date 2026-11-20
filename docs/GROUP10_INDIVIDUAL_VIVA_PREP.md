# Group 10 — Individual Viva Preparation Guide (Individual Marking)

> **Team (Group 10):** Ganesh · V Karthik · Charith Reddy  
> **Key Rule from Panel:** *"After the demo, we would ask questions regarding the implementation of the project. Marking will be individual."*

Every team member **must understand the full architecture**, and each member should also own a deep-dive domain so panel questions can be answered crisply down to exact file names, SQL constraints, and line-level logic.

---

## 1. Recommended Module Ownership Split

| Teammate | Primary Deep-Dive Modules | Key Files to Know Cold |
| :--- | :--- | :--- |
| **Ganesh** | Core Fairness Engine, Hybrid Atomic Allocation, Transactional Outbox, Cross-Replica WS Tailer, Automated Test & Benchmark Suite | `backend/services/fairnessEngine.js`, `backend/services/bookingService.js`, `backend/db/database.js`, `tests/benchmark-fairness-50seeds.js`, `tests/test-phase10-validation.js` |
| **V Karthik** | 15-Screen React SPA, 84-Seat Interactive Map, Custom `[start, end)` Interval Booking, Mon–Fri Timetable / Holidays / Ticket Releases, Idempotent WS Client | `frontend/src/views/WorkstationMapView.jsx`, `frontend/src/views/AdminScheduleView.jsx`, `frontend/src/context/SocketContext.jsx`, `frontend/src/context/AuthContext.jsx`, `backend/services/scheduleService.js`, `backend/services/availabilityService.js` |
| **Charith Reddy** | Zero-Trust Auth (HS256 JWT + `HttpOnly`/`Secure` Cookie), 2-Role + `ACCESS_OPERATOR` RBAC, HMAC-SHA256 QR Gate Verification, Maintenance Auto-Reallocation, Nginx LB + PM2 + PostgreSQL 16 VM Deployment | `backend/middleware/auth.js`, `backend/routes/auth.js`, `backend/routes/access.js`, `backend/services/passService.js`, `backend/services/verificationService.js`, `backend/services/gpuResourceService.js`, `backend/db/postgres-schema.sql` |

---

## 2. Must-Know Facts for ALL 3 Members (Zero-Slippage Cheat Sheet)

1. **Lab Inventory:** Lab L-106 has **84 workstations** = Block A (`6 rows × 10 = 60`, `L106-PC-01..60`) + Block B (`4 rows × 6 = 24`, `L106-PC-61..84`).
2. **Half-Open Interval Math:** Every reservation uses `[start, end)`. Two intervals overlap iff `start_a < end_b AND start_b < end_a`. So `10:00–11:00` and `11:00–12:00` do **NOT** overlap.
3. **Fairness Formula (Active Default Policy):**
   $$P_u = \max\bigl(10,\; \operatorname{round}(100 - 5 \cdot T_u - \text{Penalties}_u)\bigr)$$
   - `T_u` = total completed hours (`5 pts/hr` deduction).
   - Voluntary cancellation = **`0` penalty**; Confirmed No-Show (>15m grace) = **`+5` penalty pts** (reduces $P_u$ by 5) + waitlist promotion.
   - **Already Developed in Code (Currently Disabled / Configurable):** High-demand peak surcharge (`high_demand_deduction_per_hour` for $\text{DemandRatio} \ge 1.5$) and optional exponential decay exist and are unit-tested in `fairnessEngine.js`, set to `0` by default in `policy_config` so active scoring stays simple and uniform.
   - Tie-break order: `Priority Score DESC → Waiting Time DESC → Timestamp ASC → Request ID ASC`.
   - **Important phrasing:** Never claim a formal mathematical proof of unconditional starvation freedom — say *"waiting-time accumulation provides a starvation-mitigation mechanism among equal-priority users under sustained contention."*
4. **Why Contention Check Is Inside `immediateTx`:** Checking `runningRound` and competing `QUEUED` requests *inside the same ACID transaction* as `INSERT INTO bookings` prevents simultaneous `AUTO` requests from bypassing fairness.
5. **Auth & RBAC Model:**
   - **2 roles ONLY:** `student` and `admin`.
   - Gate check-in/check-out requires `role === 'admin'` **AND** permission `ACCESS_OPERATOR`. Ordinary admins (`ssen@iitbhilai.ac.in`) get `403`.
   - In `NODE_ENV=production`, `x-user-id` is strictly ignored (`401`), `/auth/switch-user` and `/auth/users` return `403`, and missing `JWT_SECRET`/`HMAC_SECRET` refuses startup.
6. **Honest Storage & Hardware Facts (Never Exaggerate!):**
   - Live API replicas (`fairlab-api-1` `:5000` & `fairlab-api-2` `:6000`) share **SQLite WAL** (`fairlab.db`, `busy_timeout=5000`) with atomic outbox claiming (`changes === 1`) and 1s cross-replica outbox tailing (`431 ms` measured WS latency Replica 1 → Replica 2).
   - **PostgreSQL 16.15** (`fairlab_db`, 18 tables, `btree_gist` `EXCLUDE USING gist` returning `23P01`) runs live on the VM and passes `8/8` DB tests, ready for full async `pg`-pool cutover.
   - **GPU Telemetry:** Displays `—` honestly because physical NVIDIA-SMI agents are planned future work.
   - **Email Ownership & HTTPS:** `@iitbhilai.ac.in` suffix check filters domains; real production requires IIT Bhilai OAuth (`hd=iitbhilai.ac.in`) / LDAP SSO + Nginx TLS/HTTPS termination.

---

## 3. Rapid-Fire Individual Panel Questions (Practice Drill)

### For Ganesh (Algorithms, Concurrency & Recovery)
- **Q:** *"How do your two backend replicas communicate WebSocket updates with each other?"*
  - **A:** Both replicas share `fairlab.db` (SQLite WAL) on the single VM. When Replica 1 commits a booking, it writes a row into `outbox_events`. Replica 2's 1-second outbox tailer (`tailOutboxEventsSince`) discovers new rows by `rowid`, invalidates its availability cache, and broadcasts the event to Replica 2's connected WebSocket clients (`431 ms` measured live). Note: sharing a SQLite WAL file works for a controlled single-VM demo; multi-host horizontal scaling requires cutting over runtime traffic to PostgreSQL 16 + a network broker (e.g., Redis Pub/Sub).
- **Q:** *"How do you prevent both replicas from publishing the same pending outbox event, and what is the crash trade-off?"*
  - **A:** `publishPendingOutboxEvents` runs an atomic conditional update `UPDATE outbox_events SET status = 'PUBLISHED' WHERE event_id = ? AND status = 'PENDING'` and checks `changes === 1`. Only the claiming replica broadcasts. We understand the exact trade-off: claiming *before* broadcasting prevents double-claiming across replicas but creates a tiny event-loss window if hard-killed right between claim and WS send (mitigated here because the sibling replica's `rowid` tailer still fans out committed rows), whereas broadcasting *before* marking avoids loss at the cost of duplicate delivery (which our client `seenEventIdsRef` Set deduplicates).
- **Q:** *"Why is PostgreSQL 16 installed on the VM if SQLite WAL is currently serving live HTTP traffic?"*
  - **A:** PostgreSQL 16 (`fairlab_db`, 18 tables + `btree_gist` `EXCLUDE USING gist`) is the target database for full institutional/multi-host rollout. We initialized and independently verified it (`8/8` live tests passing + `pg_dump` backup), while keeping synchronous SQLite WAL for the current single-VM two-replica demo; cutting live service modules over to async `pg` pooling is clearly scoped future work.
- **Q:** *"What happens if 100 students click Book at the exact same millisecond?"*
  - **A:** `submitBookingRequest` validates with Zod + overlap check + daily quota inside a transaction. Under contention, `immediateTx` sees competing `QUEUED` rows and routes all requests to `SCHEDULED`. In `test-concurrency.js`, 100 concurrent requests vs 5 seats completed in `~172 ms` with zero duplicates and exact top-5 score winners.

### For V Karthik (Frontend, Scheduling & Real-Time UI)
- **Q:** *"How does the frontend avoid duplicate notifications if an outbox event is redelivered after a crash?"*
  - **A:** Every outbox WebSocket frame carries its deterministic `eventId`. In `SocketContext.jsx`, `seenEventIdsRef` tracks the most recent 500 `eventId`s and ignores duplicates. Meanwhile, critical write operations remain idempotent on the backend via `Idempotency-Key` and DB constraints.
- **Q:** *"How do Mon–Fri academic labs, holidays, and ticket releases interact with student booking?"*
  - **A:** `scheduleService.checkIntervalScheduleStatus()` evaluates in order: (1) Date Override (holiday closes lab; extra day adjusts open/close hours or ignores weekday timetable), (2) Mon–Fri recurring academic lab blocks (blocks overlapping intervals), (3) max 2-hour duration limit, and (4) Admin Ticket Release seat caps (`COUNT(DISTINCT machine_id)`).

### For Charith Reddy (Security, QR Gate & Campus VM Ops)
- **Q:** *"Why does the QR token contain no student name or roll number?"*
  - **A:** It uses a zero-PII format `FAIRPASS:<bookingId>:<hmac16>` signed with server-side `HMAC_SECRET`. Even if photographed, no PII leaks and it cannot be forged without the secret; once checked in (`VALID → CHECKED_IN`), any replay scan returns `ALREADY_CHECKED_IN` (`authorized: false`).
- **Q:** *"How do you prove Nginx is actually load-balancing and that both replicas share sessions?"*
  - **A:** Nginx (`:3000 → :3500`) uses `upstream fairlab_backends { least_conn; server 127.0.0.1:5000; server 127.0.0.1:6000; }`. Both PM2 replicas load the identical `JWT_SECRET` and `HMAC_SECRET` from `/home/student/fairlab/.env` (`chmod 600`), so a token signed by Replica 1 verifies on Replica 2 (`200 OK`), and `/health` alternates between `fairlab-api-1` and `fairlab-api-2` with `X-Upstream-Addr`.

