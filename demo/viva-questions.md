# FairLab Viva Questions and Answers

Answer from what is implemented and measured. Avoid presenting planned PostgreSQL migration or benchmark numbers as live production behavior.

## Project and architecture

### 1. What problem does FairLab solve?
It manages reservations for shared workstations, makes availability visible, applies fairness-aware allocation rules, and supports QR-based gate access. It aims to reduce contention and prevent conflicting reservations.

### 2. What is the high-level architecture?
React/Vite frontend → Nginx reverse proxy/load balancer → two Node.js/Express API replicas → shared SQLite WAL database. WebSocket events signal changes across clients; a transactional outbox and replica tailer propagate durable events. PostgreSQL is an isolated evaluation target, not the current live application database.

### 3. Why two backend replicas?
They provide parallel request handling and some process-level resilience. They do not by themselves make the system highly available: both share a VM and database, so VM or database failure remains a shared failure domain.

### 4. Why is there one database behind two backends?
Both replicas need the same authoritative reservation state. Separate databases without a consistency/replication design could each allocate the same seat. Sharing one DB preserves a common state, though it can become a throughput or availability bottleneck.

### 5. What is the main single point of failure?
The shared VM and shared live database are major failure domains. Nginx and two app processes cannot protect against loss of the VM or its storage. Production resilience would need independent hosts, durable backups, monitored recovery, and a highly available database design.

### 6. What is the methodology?
Identify contention and integrity risks; model users, workstations, slots, and reservations; define invariants; implement API/UI flows; enforce validation and transactional rules; test ordinary, boundary, and concurrent cases; deploy and observe. In the viva, show the actual tests/results available in the repository rather than claiming unrun experiments.

## Booking screen and WebSockets

### 7. What do green and red seats mean?
They indicate the availability state returned for the currently selected date and time interval, interpreted using the rendered UI legend. Availability can become stale; submit-time server validation is decisive.

### 8. Is the green/red change itself a WebSocket?
No. CSS/React renders the color. The map gets availability with HTTP. A WebSocket event such as `SLOT_UPDATED` tells the page that state may have changed; the page refetches availability over HTTP and rerenders.

### 9. Which operations use HTTP and which use WebSockets?
Initial reads, availability, booking submission, cancellation, and other API operations use HTTP. WebSockets carry asynchronous event notifications such as booking/slot changes. When the site is HTTP the socket is `ws://`; with HTTPS it should be `wss://`. The documented campus demo URL is HTTP, so don’t describe it as HTTPS without verifying TLS deployment.

### 10. What happens if a user clicks a green seat at the same time as another user?
Both clients could have a stale view. The server validates at submission and the DB transaction/constraints must ensure only a non-conflicting reservation commits. One user may receive a conflict and must refresh/select another seat.

### 11. Why not poll instead of WebSockets?
Polling is simpler but repeatedly requests state even when nothing changes and adds update delay. WebSockets provide lower-latency push signals. A robust system still needs reconnect/refetch behavior because sockets can disconnect.

### 12. Does a WebSocket prove that a notification was received?
No. A send is not proof that a disconnected browser processed or displayed it. Persistent notification history belongs in the database; WebSocket is a fast delivery path. For stronger client acknowledgment, add acknowledgments, replay cursors, and retention semantics.

### 13. Why keep an outbox if WebSockets exist?
The booking DB commit and network send are not one atomic operation. The outbox records the event in the same transaction as the state change so a publisher can retry after a crash. Delivery is potentially duplicated, so consumers should be idempotent. It is not a replacement for a persistent user notification inbox.

### 14. What is an outbox event lifecycle?
A mutation commits state and a `PENDING` outbox row together; a publisher claims/publishes it and marks it `PUBLISHED`; pending work can be retried after failure. Cross-replica tailing lets connected clients of either process receive updates.

## Data and consistency

### 15. Why SQLite WAL?
SQLite is embedded and operationally simple for a single-host application. WAL allows readers alongside a writer and improves practical concurrency. SQLite still serializes writes and the VM/storage remain shared resources; WAL is not multi-primary replication.

### 16. Why evaluate PostgreSQL?
PostgreSQL offers a client/server model, richer concurrency and operational tooling, and native range/exclusion constraints via `btree_gist`. Migration requires converting service code and testing transactions, migrations, locking, pooling, backups, and failure recovery. Current live runtime remains SQLite until that path is validated.

### 17. Why not use NoSQL?
The core domain has relational integrity and conflict-sensitive reservations. A relational database directly supports transactions, foreign keys, unique constraints, and joins. NoSQL may fit specific high-scale access patterns, but it would not automatically solve booking races and could add consistency complexity.

### 18. What does `btree_gist` do?
It provides GiST operator classes for scalar types so PostgreSQL exclusion constraints can combine equality (such as workstation ID) with range overlap checks. It is used by the PostgreSQL schema’s interval-based conflict prevention. It does not apply to the current SQLite live DB.

### 19. What does half-open interval `[start, end)` mean?
The start is included and end excluded. Thus 10:00–11:00 and 11:00–12:00 can be adjacent without overlapping, while 10:30–11:30 conflicts with the first.

### 20. What is idempotency and why use it?
Repeating a request with the same idempotency key should return/reuse the original operation rather than create duplicate bookings. It protects against client retries and uncertain network outcomes. It must be scoped and persisted correctly server-side.

### 21. What is a database transaction?
A group of operations committed all together or rolled back together. Booking creation and associated records/events should preserve invariants if any step fails.

### 22. What are indexes and their trade-offs?
Indexes speed up lookups on selected columns but use storage and add work to inserts/updates. Indexes should reflect query patterns and be checked with query plans; adding indexes everywhere can slow writes.

## Fairness and algorithms

### 23. How is fairness different from first-come-first-served?
FCFS prioritizes arrival order and can reward low latency or automation. A fairness-aware scheduler ranks eligible requests using configured priority factors and deterministic tie-breakers. Explain the exact formula from the current fairness section/code rather than improvising weights.

### 24. What if two users have the same fairness score?
The system applies deterministic tie-breakers documented in the model, including eligible waiting time and a stable request identifier. Confirm the configured ordering in the current code before giving a precise sequence.

### 25. What is Gini coefficient?
A distribution inequality measure: 0 indicates equal values; higher values indicate more concentration/inequality. State the measured population and metric; do not confuse fairness-score Gini with reservation outcomes.

### 26. What is Jain’s fairness index?
A measure from 0 to 1 where 1 indicates equal allocation across the measured users. It complements Gini; both depend on the workload and metric being measured.

### 27. Can a fairness algorithm guarantee no starvation?
Only under stated assumptions. A wait-time tie-breaker can mitigate starvation among eligible equal-priority requests, but continuous higher-priority demand, eligibility changes, or a finite supply can still delay a user. Avoid claiming an unconditional guarantee.

### 28. Why use both Gini and Jain’s index?
They provide complementary views of allocation inequality. Neither alone proves the policy is ethically fair or suitable; compare across defined workloads and inspect outliers and waiting time too.

## API, validation and security

### 29. What is Zod used for?
Zod defines runtime schemas for request data, such as required fields, formats, lengths, enums, and array limits. TypeScript/JavaScript types alone disappear at runtime; server validation rejects malformed input before business logic.

### 30. Is frontend validation enough?
No. A client can be modified or bypassed. The backend must validate every untrusted request and authorize the authenticated principal.

### 31. What is RBAC?
Role-based access control assigns permissions by role. For example, a gate operator should have gate verification permissions but not policy administration. Check authorization on the server for every protected endpoint.

### 32. What are IDOR and how do you prevent it?
Insecure Direct Object Reference occurs when changing an ID accesses another user’s object. Check ownership/authorization server-side for each referenced booking/pass; opaque IDs alone are not authorization.

### 33. What is rate limiting?
It limits request volume by identity/IP/time window to reduce abuse and resource exhaustion. Know the project’s actual middleware and algorithm from code; don’t call it sliding/leaky bucket unless that implementation is verified.

### 34. How are SQL injection and XSS mitigated?
Use parameterized database queries and avoid unsafe HTML rendering; validate inputs and encode output in the appropriate context. Validation helps but does not replace parameterization/encoding.

### 35. How does the QR pass resist forgery or replay?
The design uses a signed token (README specifies HMAC-SHA256) and server-side pass state/expiry so invalid, expired, or already-used passes can be rejected. Signing provides integrity, not secrecy; replay prevention requires one-time state transition at the server.

### 36. What is HTTPS vs WSS?
HTTPS encrypts HTTP traffic with TLS. WSS is WebSocket over TLS. A browser page served over HTTPS should use WSS to avoid mixed-content blocking and protect socket traffic.

## Testing, operations, limitations

### 37. What tests did you perform?
Describe only test suites actually run and their results. The repository README lists automated suites covering booking, concurrency, PostgreSQL adapter/schema, security, and fairness. The isolated PostgreSQL evaluation checks do not prove live Express services are PostgreSQL-compatible.

### 38. What is a race condition?
Two operations interleave and observe/update shared state in a way that violates an invariant. Concurrent booking tests try to expose this; database constraints and transactions are the final protection, not UI locking.

### 39. What does load balancing do?
Nginx forwards requests among backend replicas. It improves request distribution and can route around some process failures, but it does not automatically synchronize in-memory state or remove shared DB/VM bottlenecks.

### 40. How would you improve this project?
Validate the complete PostgreSQL path end-to-end before migration; add backups/restore drills and independent failure domains; measure DB contention and API latency; add socket replay/ack semantics if required; monitor queue depth, errors, DB locks, and replica health; improve accessibility by pairing color with text/patterns; and run controlled load tests in a staging environment.

### 41. What are current limitations?
The current campus demo uses HTTP; live persistence is on one shared SQLite WAL DB; two app processes share one VM/failure domain; PostgreSQL is not serving live requests; a WebSocket event is not guaranteed receipt; and a displayed availability map can be stale until server-side revalidation.

### 42. What would you say if the panel asks whether everything is bug-free?
“No nontrivial software can be honestly guaranteed bug-free. We tested defined scenarios and invariants, and I can show those results. Remaining risks include deployment/network failures, untested edge cases, and the PostgreSQL migration path, which is not live.”

## Individual contribution questions (prepare truthful answers)

### 43. What did you personally implement?
Prepare a precise list of your own commits/files/features. Do not claim team members’ work as yours.

### 44. What was the hardest bug and how did you debug it?
Use one real example: symptom → reproduction → root cause → fix → regression test. Avoid inventing a story; show the relevant commit/test if possible.

### 45. What would you change with more time?
Name one measurable improvement, why it matters, and how you would verify it—for example, staging load tests plus PostgreSQL end-to-end compatibility before any migration.

