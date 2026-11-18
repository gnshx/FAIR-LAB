# FairLab v1.0.0 — Final Release & Acceptance Checklist

> **Project:** FairLab — Fairness-Aware Workstation Booking & Allocation System  
> **Scope:** IIT Bhilai · Computer Lab L-106 (`84` Workstations: Block A `6×10` + Block B `4×6`)  
> **Status:** Architecture Frozen · Final Acceptance Verified · Release Tag `v1.0.0`

---

## 1. The Four Mandatory Acceptance Checks

| # | Area | Verification Method | Result |
| :---: | :--- | :--- | :---: |
| **1** | **Simultaneous Allocation Race** | `Promise.all` 6-student simultaneous `AUTO` race on contested `L106-PC-07` (`test-phase10-validation.js` V3.9–V3.11) + 100-request concurrency stress test (`test-concurrency.js`) + 30-student overlap race (`test-overlap-concurrency.js`) | **PASS** — 0 HTTP 500s, 0 double bookings, 0 fairness bypass |
| **2** | **Hard `SIGKILL` Outbox Recovery & Deduplication** | Revert broadcast `event_id` to `PENDING`, hard-kill server with `SIGKILL` (ungraceful crash), restart server, verify SQLite WAL recovery + startup sweep transitions `PENDING → PUBLISHED` + frontend bounded `Set(500)` deduplicates recent UI notifications while backend mutations stay idempotent via `Idempotency-Key` & DB constraints (`test-phase10-validation.js` V7.1–V7.7) | **PASS** — clean WAL recovery & safe redelivery |
| **3** | **Production Security & Deployment Config** | Boot live `NODE_ENV=production` server with `JWT_SECRET`, `HMAC_SECRET`, `CORS_ORIGIN`; verify fail-fast without secrets, `HttpOnly; SameSite=Lax; Secure` cookie on login/logout, `401` on spoofed `x-user-id` across all route groups, and `403` on `/auth/switch-user` & `/auth/users` (`test-phase10-validation.js` V6.4–V6.8) | **PASS** — zero-trust production mode enforced |
| **4** | **Honest Hardware Telemetry Labeling** | Audited UI (`AdminWorkstationsView.jsx`, `AdminOverviewView.jsx`) and HLD (`FAIRLAB_FINAL_HLD_LLD.md`): GPU telemetry displays `—` with explicit notice that NVIDIA-SMI hardware agents are planned future work and no synthetic GPU readings are fabricated | **PASS** — 100% honest labeling |

---

## 2. Ten-Point Final Release Checklist

- [x] **1. Clean Clone & Installation** — Repository contains zero hardcoded secrets, zero `.db` artifacts, `.env.example` template, and reproducible `npm install` + `npm run build` (`frontend/dist/`).
- [x] **2. Fresh Database Initialization** — Deleting local SQLite files and starting `backend/server.js` auto-creates schema, triggers, `84` workstations (Block A `60` + Block B `24`), `9` hourly slots, Mon–Fri academic timetable, ticket releases, and `9+` demo personas (`V1.1–V1.14`). PostgreSQL 16 schema verified via `test-postgres.js` and `test-app-on-postgres.js`.
- [x] **3. Student Demonstration Account** — `priya.s@iitbhilai.ac.in` and `ganesh.k@iitbhilai.ac.in` verified end-to-end: `@iitbhilai.ac.in` login, HS256 JWT + `HttpOnly` cookie, 84-seat map, custom `[start, end)` booking (≤2h max), signed HMAC QR pass, check-in, check-out score deduction (`100 → 95`), and 0-penalty voluntary cancellation (`V2.1–V2.17`).
- [x] **4. Admin & `ACCESS_OPERATOR` Demonstration** — Strictly 2 roles (`student`, `admin`). Ordinary admin (`ssen@iitbhilai.ac.in`) can manage allocation rounds but receives `403` at physical gate check-in/out; designated gate operator (`accessdesk.l106@iitbhilai.ac.in`) and full coordinator (`aksharma@iitbhilai.ac.in`) hold `ACCESS_OPERATOR` and pass gate RBAC (`V5.1–V5.8`).
- [x] **5. Fairness Contention Demonstration** — Under contested windows, atomic contention check inside `immediateTx` blocks `AUTO` bypass; higher fairness score (`Priya`) ranks #1 and wins preferred seat `L106-PC-01` even when submitting after lower-score students (`V3.1–V3.11`).
- [x] **6. Booking Cancellation & Maintenance Demonstration** — Voluntary student cancellation via JWT incurs `0` penalty and frees the seat; admin maintenance toggle (`L106-PC-84`) automatically reallocates active bookings to healthy seats and blocks new requests until restored (`V2.17`, `V4.1–V4.5`).
- [x] **7. Server Restart & Recovery Demonstration** — Both graceful restart and hard `SIGKILL` crash recover SQLite WAL cleanly and publish `PENDING` outbox events with deterministic `eventId` (`V7.1–V7.7`).
- [x] **8. Production Security Configuration Review** — `.gitignore` excludes `.env`, `credentials.json`, `token.json`, `*.db`; `config.js` fails fast in production when secrets are absent; `CORS_ORIGIN` allowlist + `credentials: true` + `Secure` cookies verified (`V6.1–V6.8`).
- [x] **9. Final Documentation & Screenshots** — Completed:
  - [`README.md`](../README.md) — Engineering overview, architecture diagrams, setup & benchmarks
  - [`docs/FAIRLAB_FINAL_HLD_LLD.md`](./FAIRLAB_FINAL_HLD_LLD.md) — 17-section Final HLD & LLD
  - [`docs/DEMO_WALKTHROUGH.md`](./DEMO_WALKTHROUGH.md) — 3/5/10-minute reproducible live demo guide
  - [`docs/VIVA_AND_PRESENTATION_GUIDE.md`](./VIVA_AND_PRESENTATION_GUIDE.md) — Final CSD slide deck outline & viva Q&A
  - `docs/figmaXclaude/` — 14-screen UI design reference set
- [x] **10. GitHub Release Tag (`v1.0.0`)** — Master suite (`14 / 14` suites, `76 / 76` Phase 10 assertions) verified passing before tagging `v1.0.0`.

---

## 3. Clear Boundary: What Is Verified vs Planned Future Work

| Verified Software Core (`v1.0.0`) | Planned Institutional / Hardware Rollout |
| :--- | :--- |
| Modular monolith API + WebSocket + 15-screen React SPA | IIT Bhilai Google Workspace OAuth (`hd=iitbhilai.ac.in`) / campus LDAP SSO for cryptographic mailbox ownership proof |
| SQLite WAL (dev/test) + PostgreSQL 16 `EXCLUDE USING gist` (`23P01`) | Formal k6/Artillery load test on target 10 vCPU / 10 GB RAM campus VM to replace peak capacity estimates (`500–2,000` users) with measured curves |
| HMAC-SHA256 zero-PII QR verification & replay rejection | Physical L-106 turnstile relay integration (`RELAY_CONTROLLER_URL`) |
| Honest `—` telemetry placeholders | Live NVIDIA-SMI telemetry agents deployed on L-106 workstations |
| Bounded `500`-entry client WS deduplication + backend `Idempotency-Key` | Redis Pub/Sub fan-out only if scaled beyond a single Node instance |
