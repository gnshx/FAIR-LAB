# FairLab (Lab L-106) — Mistakes Encountered, Root Causes & Comprehensive Fixes

**Author & Developer:** NDS Ganesh (Roll: BT23CSE001 · M.Tech CSE, IIT Bhilai · Email: ganesh.k@iitbhilai.ac.in)

This document records all functional, architectural, visual, mobile, and test-suite issues identified during the development and live deployment of FairLab (IIT Bhilai Lab L-106 Workstation Fairness & Allocation System), along with their root causes, engineering fixes, and verification evidence.

---

## Table of Contents
1. [Issue 1: False Upcoming Booking Indicator & Stale QR Pass Preview](#issue-1-false-upcoming-booking-indicator--stale-qr-pass-preview)
2. [Issue 2: Dashboard Metric Inconsistency & Empty Queue View on Navigation](#issue-2-dashboard-metric-inconsistency--empty-queue-view-on-navigation)
3. [Issue 3: Gate Turnstile Scanner Not Requesting Camera Permissions](#issue-3-gate-turnstile-scanner-not-requesting-camera-permissions)
4. [Issue 4: Workstation Maintenance State Not Live-Syncing & Missing Re-enable Toggle](#issue-4-workstation-maintenance-state-not-live-syncing--missing-re-enable-toggle)
5. [Issue 5: Starvation on Contested Preferred Workstations & Missing Alternatives](#issue-5-starvation-on-contested-preferred-workstations--missing-alternatives)
6. [Issue 6: Double-Click Zoom & High-Contrast Modal for QR Pass](#issue-6-double-click-zoom--high-contrast-modal-for-qr-pass)
7. [Issue 7: Duplicate Booking Confirmation Notifications](#issue-7-duplicate-booking-confirmation-notifications)
8. [Issue 8: Hardcoded 5-Day Ticket Release & Missing Multi-Day Overview](#issue-8-hardcoded-5-day-ticket-release--missing-multi-day-overview)
9. [Issue 9: Manual Admin Allocation Bottleneck in Queue Resolution](#issue-9-manual-admin-allocation-bottleneck-in-queue-resolution)
10. [Issue 10: Mobile Form-Factor Responsiveness & Turnstile Security UX](#issue-10-mobile-form-factor-responsiveness--turnstile-security-ux)
11. [Issue 11: Foreign Key Cascade & Constraint Violations in Test Teardown](#issue-11-foreign-key-cascade--constraint-violations-in-test-teardown)
12. [Issue 12: Production-Mode Zero-Trust Header Rejections in Red-Team Suite](#issue-12-production-mode-zero-trust-header-rejections-in-red-team-suite)
13. [Verification Summary & Test Suite Results](#verification-summary--test-suite-results)

---

### Issue 1: False Upcoming Booking Indicator & Stale QR Pass Preview
* **Symptom**: In the Student Workspace under *My Bookings*, the counter showed 0 upcoming reservations, but an active QR access pass card was still rendered in the right-hand panel displaying a past or mock booking.
* **Root Cause**: The view component retrieved `bookings[0]` directly without verifying that the booking's `status` was `CONFIRMED` or `CHECKED_IN` and that its date and slot corresponded to the active operating window.
* **Engineering Fix**:
  * Added strict filtering: `isPassDisplayable = activeBooking && ['CONFIRMED', 'CHECKED_IN'].includes(activeBooking.status) && activeBooking.booking_date === today`.
  * If no active reservation exists, the pass card is replaced with an actionable empty state guiding the student to "Book a Workstation".
* **Files Modified**: `frontend/src/views/StudentMyBookingsView.jsx`, `backend/routes/bookingRoutes.js`.

---

### Issue 2: Dashboard Metric Inconsistency & Empty Queue View on Navigation
* **Symptom**: Admin Overview card indicated "Pending requests: 5", but clicking "Inspect allocation queue" navigated to `/allocation` and displayed "No queued requests for this interval yet".
* **Root Cause**: The allocation view defaulted to `slot-1` (09:00–10:00), whereas the seeded pending requests resided in `slot-4` (12:00–13:00). Navigation did not preserve or forward the targeted `slotId` or `bookingDate`.
* **Engineering Fix**:
  * Updated navigation router in `AdminOverviewView.jsx` to pass exact query parameters: `/allocation?date=${today}&slot=${activePendingSlot}`.
  * Added auto-detection in `AdminAllocationRoundView.jsx` to select the earliest slot containing queued requests if none is explicitly specified.
  * Synchronized live pending counts through WebSocket transactional outbox broadcasts.
* **Files Modified**: `frontend/src/views/AdminOverviewView.jsx`, `frontend/src/views/AdminAllocationRoundView.jsx`.

---

### Issue 3: Gate Turnstile Scanner Not Requesting Camera Permissions
* **Symptom**: On the Turnstile Gate Access Control screen (`/access`), clicking the optical scanner did not prompt the user or security guard to grant camera permissions.
* **Root Cause**: The component only rendered a passive drag-and-drop file target and lacked a WebRTC stream trigger (`navigator.mediaDevices.getUserMedia`) as well as native mobile device capture.
* **Engineering Fix**:
  * Implemented WebRTC live camera feed with an interactive overlay reticle and a toggle to stop/start the camera stream.
  * Added native smartphone camera support: `<input type="file" accept="image/*" capture="environment">`, allowing security guards on Android/iOS phones to take instant snapshots of student QR passes with autofocus.
  * Integrated HTML5 optical barcode/QR parsing via Canvas 2D image analysis.
* **Files Modified**: `frontend/src/views/AdminAccessControlView.jsx`.

---

### Issue 4: Workstation Maintenance State Not Live-Syncing & Missing Re-enable Toggle
* **Symptom**: When placing a workstation into maintenance, the UI required a full browser refresh to reflect the state. Furthermore, there was no action available to bring a maintenance machine back to `AVAILABLE`.
* **Root Cause**:
  * The maintenance endpoint was a one-way toggle (`isMaintenance: true`).
  * The frontend did not subscribe to maintenance or timetable WebSocket push events.
* **Engineering Fix**:
  * Upgraded `POST /api/v1/admin/workstation/toggle-maintenance` to support bidirectional toggling (`isMaintenance: true/false`), restoring status to `AVAILABLE` and publishing `WORKSTATION_MAINTENANCE_TOGGLED`.
  * Connected `useWebSocket` hook in `AdminWorkstationsView.jsx` and `WorkstationMapView.jsx` to listen for maintenance, holiday, timetable, and ticket release events, updating seat states reactively without page reloads.
* **Files Modified**: `backend/services/workstationService.js`, `backend/routes/adminRoutes.js`, `frontend/src/views/AdminWorkstationsView.jsx`, `frontend/src/views/WorkstationMapView.jsx`.

---

### Issue 5: Starvation on Contested Preferred Workstations & Missing Alternatives
* **Symptom**: If a student with high fairness points (e.g. 100 pts) requested workstations that were already claimed by earlier confirmed bookings, the student was placed in a queue with no suggestions of free alternative machines.
* **Root Cause**: The booking request flow was strictly preference-bound without cluster-aware fallback suggestions.
* **Engineering Fix**:
  * Enhanced `getLabAvailability` to calculate available alternative workstations in the same Block and Row and return them in the response.
  * In autonomous allocation, if all 3 preferences are contested, the engine automatically assigns the next available workstation with the lowest load in the same row/block.
* **Files Modified**: `backend/services/availabilityService.js`, `backend/services/bookingService.js`, `frontend/src/views/WorkstationMapView.jsx`.

---

### Issue 6: Double-Click Zoom & High-Contrast Modal for QR Pass
* **Symptom**: The QR code on mobile devices was too small to be scanned reliably under bright ambient lighting or through turnstile optical lenses.
* **Root Cause**: Fixed 144px QR size with no full-screen zoom capability.
* **Engineering Fix**:
  * Added `onDoubleClick` and mobile tap handler on the QR code canvas.
  * Renders a full-screen backdrop modal with a 320px high-contrast QR display, machine identifier, check-in time window, and screen brightness optimization.
* **Files Modified**: `frontend/src/views/StudentMyBookingsView.jsx`.

---

### Issue 7: Duplicate Booking Confirmation Notifications
* **Symptom**: Students received two identical booking confirmation notifications for a single reservation.
* **Root Cause**: Notifications were triggered both upon initial request creation in `submitHybridBookingRequest` and during the batch allocation round in `runWindowAllocationRound`.
* **Engineering Fix**:
  * Added deduplication logic in `notificationService.js` checking `(user_id, type, aggregate_id)` before persisting and dispatching notifications.
* **Files Modified**: `backend/services/notificationService.js`, `backend/services/bookingService.js`.

---

### Issue 8: Hardcoded 5-Day Ticket Release & Missing Multi-Day Overview
* **Symptom**: Admin ticket release was restricted to a static 5-day batch button with no ability to inspect individual released days or customize the release window.
* **Root Cause**: The backend and frontend lacked a calendar overview query and a flexible date-range generator.
* **Engineering Fix**:
  * Added `GET /api/v1/admin/tickets` to list all released dates, total quotas, and statuses (`RELEASED`, `PAUSED`, `CLOSED`).
  * Built configurable multi-day release modal (1 to 14 days) allowing custom quotas, individual day pauses, and quota edits.
* **Files Modified**: `backend/routes/adminRoutes.js`, `backend/services/ticketService.js`, `frontend/src/views/AdminTicketsView.jsx`.

---

### Issue 9: Manual Admin Allocation Bottleneck in Queue Resolution
* **Symptom**: Contested slots required an administrator to manually log in, inspect candidate rankings, and click "Commit allocation", delaying students unnecessarily.
* **Root Cause**: The system lacked an autonomous execution loop for batch allocation rounds.
* **Engineering Fix**:
  * Built `autonomousAllocationService.js` running on a background cron:
    * Uncontested bookings confirm instantly (`IMMEDIATE` mode).
    * Contested slots are processed automatically at the cutoff window (15 minutes prior to slot start).
    * Ranks candidates mathematically: $P_u = \max(10, 100 - 5 T_u - 10 T_H)$, breaking ties by cumulative wait time and request timestamp.
    * Issues cryptographic access passes automatically.
* **Files Modified**: `backend/services/autonomousAllocationService.js`, `backend/server.js`, `backend/routes/bookingRoutes.js`.

---

### Issue 10: Mobile Form-Factor Responsiveness & Turnstile Security UX
* **Symptom**: UI was broken on smartphone viewports (360px–480px): sidebar occupied the full width, workstation rows were compressed, camera viewfinder clipped, and switching user personas required desktop viewports.
* **Engineering Fix**:
  * **Slide-Out Mobile Drawer**: Added touch-friendly navigation drawer with active state badges.
  * **1-Tap Mobile Persona Switcher**: Header popover allows switching between Student (`NDS Ganesh`), Coordinator (`Dr. A. K. Sharma`), and Security (`Ram Singh`) with genuine JWT sessions on mobile.
  * **Priority Pass Layout**: Active pass appears at the top of the mobile screen (`order-first xl:order-last`).
  * **Sticky Booking Bar**: Fixed bottom bar allows instant booking submission without scrolling through all 84 workstations.
  * **Viewfinder Resizing**: Mobile-first height `h-72 sm:h-auto` with touch targets $\ge 44\text{px}$.
* **Files Modified**: `frontend/src/App.jsx`, `frontend/src/views/WorkstationMapView.jsx`, `frontend/src/views/AdminAccessControlView.jsx`, `frontend/src/views/StudentMyBookingsView.jsx`.

---

### Issue 11: Foreign Key Cascade & Constraint Violations in Test Teardown
* **Symptom**: Running `node tests/run-all-tests.js` failed with `SqliteError: FOREIGN KEY constraint failed` and `SqliteError: UNIQUE constraint failed`.
* **Root Cause**:
  * Deleting from `booking_requests` failed because `booking_preferences` and `waitlist_entries` held FK references.
  * Deleting from `users` in `test-seatmap-fairness-v2.js` failed because `workstations.current_user_id` was set to `usr-v2-high` during re-allocation testing.
  * Forcing `UPDATE bookings SET status = 'CONFIRMED' WHERE machine_id = 'L106-PC-05'` collided with partial unique index `idx_unique_active_user_slot`.
* **Engineering Fix**:
  * Implemented cascaded teardown in exact foreign-key dependency order:
    `workstations.current_user_id = NULL` $\rightarrow$ `notifications` $\rightarrow$ `entry_logs` $\rightarrow$ `allocation_history` $\rightarrow$ `access_passes` $\rightarrow$ `bookings` $\rightarrow$ `waitlist_entries` $\rightarrow$ `booking_preferences` $\rightarrow$ `booking_requests` $\rightarrow$ `student_fairness` $\rightarrow$ `users`.
  * Removed forced `UPDATE` statements and made test assertions resilient to background no-show cron updates.
* **Files Modified**: `tests/test-concurrency.js`, `tests/test-seatmap-fairness-v2.js`, `tests/test-custom-interval-v3.js`.

---

### Issue 12: Production-Mode Zero-Trust Header Rejections in Red-Team Suite
* **Symptom**: `test-adversarial-redteam.js` threw `AssertionError: 401 !== 201` when run against the live VM.
* **Root Cause**: The live PM2 processes run with `NODE_ENV=production`. In production mode, FairLab's zero-trust security layer strictly rejects client-supplied `x-user-id` headers unless accompanied by a verified HS256 JWT `Authorization: Bearer <token>` signed with `config.JWT_SECRET`.
* **Engineering Fix**:
  * Enhanced `httpRequest` in `tests/test-adversarial-redteam.js` to automatically sign authentic HS256 JWT Bearer tokens using `signAuthToken(user)` for valid registered test personas.
  * Unregistered personas (e.g. `usr-nonexistent-sybil-999`) and tampered tokens omit valid signatures, ensuring adversarial security tests pass cleanly in both development and production environments.
* **Files Modified**: `tests/test-adversarial-redteam.js`.

---

### 14. Missing React Hook Import (`useMemo`) & Lack of Error Boundary Leading to Blank White Screen on `/schedule`
* **Symptoms & Discovery**:
  * Navigating to `http://10.1.75.40:3500/schedule` rendered a completely blank white screen in the browser (`media_1795161491634_ad806ff6.png`).
* **Root Cause**:
  * In `AdminScheduleView.jsx`, `coverageDays` was refactored to compute 14-day ticket drop coverage using `useMemo`, but `useMemo` was omitted from the `import React, { ... } from 'react'` statement.
  * Vite/Rollup tree-shaking allowed the production build to compile without failing on undeclared global identifiers.
  * At runtime, opening `/schedule` threw `ReferenceError: useMemo is not defined`.
  * Because React 18 unmounts the entire DOM root on unhandled component errors and no top-level `ErrorBoundary` was present, the entire viewport went pure white.
  * Previous test suites verified backend HTTP/REST endpoints via Node `http`, but lacked real browser DOM rendering tests.
* **Resolution & Permanent Mistake-Proofing**:
  * Corrected React hook imports in `AdminScheduleView.jsx` (`import React, { useState, useEffect, useCallback, useMemo } from 'react'`).
  * Added defensive array guards (`(Array.isArray(x) ? x : []).filter(...)`) across all timetable, override, and ticket release lists.
  * Built a production-grade React class `<ErrorBoundary>` (`frontend/src/components/ErrorBoundary.jsx`) with automatic error containment, clean recovery card, and 1-click "Reload View" / "Return to Dashboard" actions.
  * Wrapped both the FairLab global application shell and individual view renderer in `App.jsx` with `<ErrorBoundary>`.
  * Created automated headless Chrome validation suite (`tests/test-frontend-views-resilience.js`) integrated into `tests/run-all-tests.js` (expanding test suites to 16) that opens and verifies all 14 routes in real Google Chrome, validating DOM content and asserting 0 uncaught runtime exceptions.

---

## Verification Summary & Test Suite Results

All 16 test suites have been verified on the live production VM (`10.1.75.40`) and local repository:

```text
================================================================
🏛️  FAIRLAB (FAIRGPU) — IIT BHILAI L-106 MASTER TEST RUNNER
================================================================
📡 Connected to live FairLab server on port 5000.

▶ Running [Full System End-to-End Integration Test]...                 ✅ PASSED
▶ Running [High-Priority Test 1: Concurrency (100 Requests vs 5 Slots)] ✅ PASSED
▶ Running [High-Priority Test 2: Semester Reset & Score Independence]  ✅ PASSED
▶ Running [High-Priority Test 3: Cryptographic QR Security & RBAC]      ✅ PASSED
▶ Running [High-Priority Test 4: Time Overlap Detection & Worker Conc]  ✅ PASSED
▶ Running [Production Database Test: PostgreSQL 16 Live Operations]    ✅ PASSED
▶ Running [Production Invariant & Application Test on PostgreSQL 16]    ✅ PASSED
▶ Running [Backend Audit & Mathematical Edge-Case Invariants]          ✅ PASSED
▶ Running [Seat Map (84 Systems), Hours+Peak Fairness, No-Show]         ✅ PASSED
▶ Running [Custom [start, end) Intervals & 3-Policy Comparison]         ✅ PASSED
▶ Running [Adversarial Red-Team: Anti-Cheat, RBAC, IDOR & Crash]       ✅ PASSED
▶ Running [Max 2h Limit, Academic Timetable, Holidays & Ticket Release] ✅ PASSED
▶ Running [Autonomous Allocation Engine & Overlap Conflict Resilience]  ✅ PASSED
▶ Running [Statistical 50-Seed Fairness Benchmark]                      ✅ PASSED
▶ Running [Phase 10: Final Validation (JWT/Cookie & Outbox Recovery)]   ✅ PASSED
▶ Running [Phase 11: Real Headless Chrome Render Test (All 14 Views)]   ✅ PASSED

================================================================
🎉 ALL 16 TEST SUITES PASSED FLAWLESSLY WITH 100% SUCCESS RATE!
================================================================
```

* **Live Frontend**: [http://10.1.75.40:3500](http://10.1.75.40:3500)
* **Live API**: [http://10.1.75.40:5000/health](http://10.1.75.40:5000/health)
* **PM2 Status**: All 3 services (`fairlab-api-1`, `fairlab-api-2`, `fairlab-ops-monitor`) active with zero crashes.

