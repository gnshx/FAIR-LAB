# FairLab Demonstration Pack

This folder contains a presentation guide, end-to-end architecture diagram, demo-day checklist, and viva questions with answers. The descriptions are based on the current repository. Read `../README.md` for the complete project documentation.

## Quick order for the live demo

1. Open the live site: <http://10.1.75.40:3500/>. Use a prepared account from the README; verify access before demo day.
2. On **Book Workstation**, select date and time, check availability, and explain the seat colors using the legend shown in the UI. Select a green seat and submit a booking.
3. Point out the booking result/pass, then open the same booking map in another browser/session and show that a live update is delivered. If the second session is unavailable, explain the event flow; do not claim a visual update you did not observe.
4. Show fairness score/booking history and, if time permits, admin overview or gate pass verification.
5. Close with the architecture, safety constraints, current SQLite live database, and PostgreSQL as an isolated evaluation target.

**Demo safety:** use only designated demo accounts and dates. Avoid load/attack scripts, real personal data, or destructive admin actions on the hosted VM. Have screenshots or a local backup if campus network access fails.

## What green and red mean on the booking map

The map is a visual projection of the availability API response for the selected lab, date, and requested time interval. In general, green means selectable/available for that interval; red means unavailable (for example booked/occupied). Maintenance/offline states may have their own styles. Always point to the rendered legend in the current UI rather than relying only on color, and explain that the server rechecks availability during booking: the map can become stale between display and click, and a database conflict must still be rejected safely. The map subscribes to booking, workstation, timetable, override, and ticket-release events and refetches availability when those events arrive.

## Is the color change a WebSocket?

The color itself is CSS/UI, not a WebSocket. The initial availability is fetched over HTTP (`GET /api/v1/availability?...`). A WebSocket connection at `/ws` carries event messages. When the map receives relevant events such as `SLOT_UPDATED`, `booking.confirmed`, `booking.cancelled`, or `workstation.status_changed`, it calls the HTTP availability endpoint again; React then rerenders the workstation states and the color may change. So the socket is the live *signal*, while HTTP supplies the refreshed availability data. A booking submission is an HTTP API request.

In the deployed two-replica setup, a mutation may occur on either backend. Durable events are written to the SQLite outbox and replicas tail it; each replica broadcasts to its own connected clients. The browser reconnects after a dropped socket and ignores duplicate event IDs it has recently processed. WebSockets are best-effort live delivery, not the booking source of truth; HTTP/database state remains authoritative.

## Files

- `walkthrough.md` — a short talk track and click-by-click live demo.
- `architecture.md` — architecture explanation and Mermaid HLD diagram.
- `viva-questions.md` — questions and concise, technically accurate answers.
- `demo-day-checklist.md` — preparation and fallback checklist.

