# FairLab — 5-Minute Public YouTube Demo Recording Script (Human Narration)

> **Assignment Rules:**
> - **Maximum Duration:** `5:00` (script timed to **`4:40`**, leaving a 20-second safety margin)
> - **Visibility:** Public YouTube link
> - **Narration:** **Human voice ONLY — no digital/AI text-to-speech narration**
> - **Required Content:** Working of the system + Fairness Algorithm + Live Website Demo

---

## Pre-Recording Checklist (2 Minutes Before Recording)

1. Set screen resolution to **1920×1080 (1080p)**, browser zoom **100%**, hide bookmarks bar.
2. Open 3 clean browser tabs:
   - **Tab 1:** `http://10.1.75.40:3500` (FairLab Main App via Nginx Load Balancer)
   - **Tab 2:** `http://10.1.75.40:7500` (Live Stack & Database Operations Dashboard)
   - **Tab 3:** `docs/diagrams/fairlab_architecture.png` & `docs/diagrams/fairlab_methodology.png` (for quick 20s architecture + algorithm overlay)
3. Keep 1 clean terminal ready (for the 15-second Nginx load-balancer check `curl -s http://10.1.75.40:3500/health`).
4. Record with OBS Studio / system screen recorder + clear microphone (speak naturally at a steady pace — ~130–140 words/minute).

---

## Second-by-Second Recording Script (`0:00 – 4:40`)

### Segment 1 · Problem, Architecture & Fairness Algorithm (`0:00 – 1:15`)
- **On Screen (`0:00 – 0:35`):** Show `docs/diagrams/fairlab_architecture.png`
- **Say (Ganesh):**
  > "Hello everyone. We are Group 10 from IIT Bhilai — Ganesh, V Karthik, and Charith Reddy — presenting **FairLab**, a fairness-aware workstation booking and access-control system built for Computer Lab L-106, which houses 84 workstations across Block A and Block B.
  >
  > Standard FIFO booking systems let fast clickers or automated scripts monopolize lab seats during exam peaks. FairLab solves this with a modular monolith deployed on our campus VM behind an **Nginx load balancer** routing traffic across **two PM2 Node.js replicas**, backed by a shared **SQLite WAL** runtime store with atomic overlap triggers, a live **PostgreSQL 16** cluster with `btree_gist` exclusion constraints, and a **Transactional Outbox** for cross-replica WebSocket updates."

- **On Screen (`0:35 – 1:15`):** Switch to `docs/diagrams/fairlab_methodology.png` (and briefly `fairlab_fairness_benchmark.png`)
- **Say (Ganesh / Karthik):**
  > "Here is how our **hybrid fairness algorithm** works. Every booking specifies a half-open interval `[start, end)` between 30 minutes and 2 hours, checked against Mon–Fri academic lab timetables, holiday overrides, and ticket release quotas.
  >
  > Inside a single ACID transaction, FairLab checks for contention. If uncontested, the student's preferred seat is confirmed immediately. If competing requests exist, it routes into a **Fairness Allocation Round** ranked by our priority score:
  > `P_u = max(10, 100 − 5·T_u − 10·T_H − Penalties)`, where normal usage deducts 5 points per hour, high-demand peak usage (`DemandRatio > 1.5`) deducts 10 points per hour, no-shows incur a 25-point penalty, and voluntary early cancellation has zero penalty. Ties break by **accumulated waiting time** to mitigate starvation. Across our 50-seed bot-skew benchmark, FairLab reduces the Gini inequality index from `0.657` under FIFO down to `0.022`, raising Jain's Fairness Index from `0.252` to `0.998`."

---

### Segment 2 · Live Demo: Student Login & 84-Seat Map (`1:15 – 2:00`)
- **On Screen:** Switch to **Tab 1 (`http://10.1.75.40:3500`)**
  1. Type `student@gmail.com` → click Sign In → show instant **`403`** rejection (`@iitbhilai.ac.in` only).
  2. Sign in as **Priya Sharma (`priya.s@iitbhilai.ac.in`)** → click **Book Workstation** to show the 84-seat map (Block A 6×10 + Block B 4×6).
- **Say (Karthik):**
  > "Now let's see FairLab live on our campus VM at `10.1.75.40:3500`. First, authentication strictly requires an `@iitbhilai.ac.in` email — non-institute domains are immediately rejected. Signing in as Priya Sharma issues a server-signed HS256 JWT and opens the interactive 84-workstation map of Lab L-106. Students can pick any custom interval up to 2 hours, see live Mon–Fri class timetable blocks, and rank up to 3 preferred seats."

---

### Segment 3 · Live Demo: Contention, Fairness Allocation & QR Pass (`2:00 – 3:10`)
- **On Screen:**
  1. Book a Saturday window (`10:00–11:00`) preferring `L106-PC-01` (or show competing requests from Ananya score `70` and Priya score `100` for the same window).
  2. Sign in as **Dr. A. K. Sharma (`aksharma@iitbhilai.ac.in`)** → open **Allocation Round** → click **Run Allocation Round** → show Priya (higher fairness score) winning Rank #1 and `L106-PC-01`.
  3. Open **My Bookings & QR Pass** as Priya → display the signed HMAC-SHA256 QR pass (`FAIRPASS:<bookingId>:<hmac16>`).
- **Say (Karthik / Charith):**
  > "When two students — Ananya with score 70 submitting earlier, and Priya with score 100 submitting later — compete for the same interval and workstation `L106-PC-01`, FairLab's atomic contention check queues them instead of letting first-click bypass fairness.
  >
  > Switching to Lab Coordinator **Dr. Sharma**, we trigger the Allocation Round. FairLab deterministically ranks Priya #1 and awards her first-choice workstation `L106-PC-01`, generating a zero-PII HMAC-SHA256 QR access pass."

---

### Segment 4 · Live Demo: Gate `ACCESS_OPERATOR` & Maintenance (`3:10 – 4:05`)
- **On Screen:**
  1. Sign in as **Ram Singh (`accessdesk.l106@iitbhilai.ac.in`)** → **Access Control** → paste/verify Priya's QR token → **`ENTRY_AUTHORIZED`** → **Check-In**.
  2. Re-verify the exact same QR token → show **`DENIED`** (single-use anti-replay).
  3. Click **Check-Out** → show `COMPLETED` & deterministic fairness score deduction (`100 → 95`).
  4. As **Dr. Sharma**, open **Workstations** → toggle a booked seat to **Maintenance** → show automatic seat reallocation and honest `—` GPU telemetry (explaining NVIDIA-SMI hardware agents are future work).
- **Say (Charith):**
  > "FairLab enforces a strict two-role model — `student` and `admin` — with physical gate operations restricted to admins holding the scoped `ACCESS_OPERATOR` permission. Ordinary faculty admins get `403` at the gate. Here, gate operator Ram Singh verifies Priya's QR pass, checks her in, proves that replaying the same QR code is immediately denied, and checks her out — freeing the workstation and deducting 5 fairness points cleanly.
  >
  > Under Admin Workstations, marking a booked PC offline for maintenance automatically reallocates active bookings to a healthy seat. Notice GPU telemetry honestly shows a dash because physical NVIDIA-SMI agents are planned future work — FairLab never fabricates hardware metrics."

---

### Segment 5 · Live Demo: Load Balancer, Replicas & Ops Monitor (`4:05 – 4:40`)
- **On Screen:**
  1. Terminal: run `for i in 1 2 3 4; do curl -s http://10.1.75.40:3500/health; echo; done` → show `fairlab-api-1` (`:5000`) and `fairlab-api-2` (`:6000`).
  2. Switch to **Tab 2 (`http://10.1.75.40:7500`)** → show all green cards (Nginx LB, Backend #1, Backend #2, PostgreSQL 16 `btree_gist`, SQLite WAL, Nginx `stub_status`).
- **Say (Ganesh):**
  > "Finally, hitting `/health` through our Nginx load balancer demonstrates live distribution across both PM2 backend replicas — `fairlab-api-1` and `fairlab-api-2` — with cross-replica JWT verification and sub-second cross-replica WebSocket event propagation. On port `7500`, our live operations dashboard confirms Nginx, both replicas, our shared SQLite WAL runtime store, and PostgreSQL 16 are all online. All 14 automated test suites and 76 acceptance assertions pass. Thank you!"

---

## YouTube Upload Checklist
- **Title:** `FairLab — Fairness-Aware Lab Workstation Booking System | IIT Bhilai CSD Group 10`
- **Visibility:** **Public** (as required by assignment)
- **Description:** Include GitHub URL (`https://github.com/gnshx/FAIR-LAB`), Live Campus URL (`http://10.1.75.40:3500`), and Team Member names (Ganesh, V Karthik, Charith Reddy).
