# Live Demo Talk Track (5–7 minutes)

## Opening (30 seconds)

“FairLab is a fairness-aware reservation and gate-access system for a shared computer lab. It shows workstation availability for a requested time, accepts booking requests through a server-validated workflow, and distributes live change signals to other users. The live deployment uses two Express replicas behind Nginx and SQLite WAL as its current database.”

## Booking map (1–2 minutes)

1. Sign in using the prepared student demo account.
2. Open **Book Workstation**. Explain that selected date and interval determine the map’s availability query.
3. Point to the on-screen legend and explain green/red in terms of the selected interval. Mention that color is only a display of the last server response; the backend checks again during submit.
4. Choose an available seat and submit a valid academic purpose. Show confirmation or the resulting request state.
5. Explain edge case: two students may click the same seat. Both may have seen green, but only a valid transaction can reserve it; the other request should get a conflict/updated availability.

## Live update (1 minute)

1. If possible, open the map in a second browser/session before changing a booking.
2. Trigger a safe booking/cancellation using demo data, then show the other map refresh its availability.
3. Explain: HTTP fetched the first availability and submitted the change; WebSocket sent an event; the map handler refetched availability via HTTP and React rerendered.
4. If network timing prevents the visible update, state that the event is best-effort and show the connection indicator/architecture. Never claim an update succeeded if you did not observe it.

## Fairness and administration (1–2 minutes)

Show the fairness view and explain the system’s priority inputs and deterministic tie-breaking based on the current README/model. Show admin views only with the correct prepared role. If using gate verification, use a demo pass and explain one-time/replay protection at a high level.

## Close (30 seconds)

“The important correctness point is that UI availability and socket events are not authoritative. The backend and database enforce the booking decision. SQLite WAL is live; PostgreSQL is being evaluated separately. The main future improvement is validating the complete async PostgreSQL path and measuring the shared database under realistic concurrency.”

## Contingencies

- If campus network fails, use the saved architecture image and screenshots from `../figmaXclaude/` (clearly identify design mockups versus live UI).
- If WebSocket disconnects, explain reconnect and use manual refresh. Do not attempt stress scripts on the hosted VM.
- If login or demo data is unavailable, avoid modifying production data; use a prepared local/demo environment.

