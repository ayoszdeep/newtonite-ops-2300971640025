# OpsDesk Backend — Architecture & Design Decisions

This document details the core architectural and design decisions implemented in the OpsDesk backend, explaining the trade-offs, guarantees, and rationale behind each decision.

---

## 1. PostgreSQL Outbox vs. External Message Broker

### Context
In operational work-item management systems, mutating a record (e.g., assigning a ticket, advancing a workflow) often requires generating downstream effects: sending in-app notifications, alerting team leads, or triggering automated hooks. 

### Why Outbox over Kafka / RabbitMQ / Redis
* **Elimination of Dual-Write Hazards:** If an application writes to a relational database and then attempts to publish a message to a broker like RabbitMQ or Redis Pub/Sub, a network glitch or process crash between those two actions leaves the system in an inconsistent state. Either the database rolls back and the message has been sent (phantom event), or the database commits and the message fails to send (lost event).
* **True Transactional Consistency:** By storing outbox events in an `outbox_events` table inside the exact same PostgreSQL transaction (`withTransaction`) as the work-item change, event emission is guaranteed to succeed or fail atomically with the state mutation.
* **Operational Simplicity:** Avoids introducing external infrastructure (brokers, clustering, operational maintenance, dead-letter exchanges) for an initial high-reliability operational system.
* **Concurrency & Safety:** The worker claims batches of pending events using `FOR UPDATE SKIP LOCKED`, preventing queue contention across multiple worker instances. It uses a lease on `locked_at` (with stale worker recovery) and conditional updates (`WHERE id = $1 AND status = 'PROCESSING' AND locked_at = $myLockedAt`) to prevent split-brain processing.
* **Notification Deduplication:** Notifications enforce a unique constraint `UNIQUE(event_id, user_id)` at the database level, ensuring that even if an outbox event is re-evaluated, duplicate notifications are never persisted.

---

## 2. Optimistic Versioning + Row Locking vs. Pessimistic Editing Locks

### Context
Multiple employees work simultaneously on team queues. Concurrent updates to tickets, status transitions, and assignments must never silently overwrite another employee's modifications (the "lost update" problem).

### The Decision
* **Optimistic Versioning (`version` column):** Every work item tracks an integer `version` initialized to 1 and incremented on every state mutation.
* **Standard Mutation Pattern:**
  1. `BEGIN` transaction.
  2. `SELECT * FROM work_items WHERE id = $1 FOR UPDATE` — locks the target row.
  3. Validate caller membership and role in `item.team_id` (returns `404 Not Found` if inaccessible).
  4. Verify that `expectedVersion === item.version` (returns `409 Conflict` with current state if mismatched).
  5. Validate workflow transition rules against current status.
  6. Execute `UPDATE ... SET ..., version = version + 1, updated_at = NOW()`.
  7. Insert audit event into `activity_events` recording exact before/after diffs.
  8. Insert outbox event into `outbox_events`.
  9. `COMMIT`.
* **Why not Pessimistic Locks (e.g., checkout/lock ticket for editing)?**
  Pessimistic locking prevents others from viewing or editing while a tab is open, leading to lock abandonment when users close browsers or lose connection. Optimistic concurrency with row-level transaction locks offers superior throughput, zero lock abandonment, and explicit conflict resolution where the frontend receives a `409 Conflict` containing the fresher record.
* **Comments do NOT bump version:** Adding a comment is an additive discussion event and does not modify the underlying ticket version, preventing false edit conflicts when team members chat on an open item.

---

## 3. Atomic Conditional `UPDATE` for Claiming

### Context
When a high-priority incident arrives (P0/P1), multiple operators may attempt to click "Claim" at the exact same millisecond.

### The Decision
* **Single-Statement Race Fix:** Rather than read-then-write, claiming executes:
  ```sql
  UPDATE work_items
  SET assignee_id = $1,
      version = version + 1,
      updated_at = NOW()
  WHERE id = $2
    AND team_id = $3
    AND assignee_id IS NULL
    AND status NOT IN ('RESOLVED', 'CLOSED')
  RETURNING *;
  ```
* **Guarantees:**
  - If a row is returned, the caller was the sole atomic winner.
  - If zero rows are returned, it was either already claimed, closed, or does not exist.
  - **Idempotency for the Same User:** If the caller already owns the claim (`assignee_id === callerId`), the endpoint immediately returns 200 OK with the item, avoiding error toasts on double-clicks or UI refreshes.
  - If claimed by another user, a `409 Conflict` with error code `ALREADY_CLAIMED` and the updated item is returned.

---

## 4. Team-Scoped RBAC Loaded from DB & Information Leak Prevention

### Context
Users belong to multiple teams (Payments, Engineering, Compliance) with different roles per team (`viewer`, `member`, `lead`).

### The Decision
* **Fresh DB Lookups per Request:** Roles are intentionally **not** encoded into JWT tokens. If a user's role is demoted or revoked, or if their account is deactivated (`is_active = false`), the change takes effect immediately on their very next HTTP request without waiting for token expiration.
* **Active User Verification:** The `authenticate` middleware loads the user's active status from PostgreSQL on every request.
* **404 Instead of 403 for Foreign Resources:** When a user attempts to access an item or team they are not a member of, the API responds with `404 Not Found` rather than `403 Forbidden`. A `403` implicitly confirms that the resource ID exists in the system, creating an information enumeration leak.
* **Composite Foreign Key:** `FOREIGN KEY (assignee_id, team_id) REFERENCES team_memberships(user_id, team_id)` enforces at the relational engine level that an item cannot be assigned to an employee who does not belong to that item's team.

---

## 5. Idempotency Keys, Keyset Pagination, and PostgreSQL Full-Text Search

### Context
Enterprise operations require reliable API interactions over unstable networks, consistent pagination through high-volume tables, and instant search capabilities without heavy external dependencies.

### The Decision
* **Database-Backed Idempotency Keys:**
  - Client sends `Idempotency-Key: <uuid>`.
  - The request hash is calculated from `method + originalUrl + canonicalSorted(body)`.
  - An atomic `INSERT INTO idempotency_keys (user_id, key, request_hash) ... ON CONFLICT (user_id, key) DO NOTHING` is executed inside the transaction.
  - Simultaneous duplicate requests block on the unique index until the first commits, then receive the stored status and response body.
  - If the same key is reused with a different payload, the API returns `422 Unprocessable Entity` (`IDEMPOTENCY_KEY_REUSED`).
  - Business errors (409/422) rollback and do not persist the key, allowing the user to correct and retry.
  - Worker automatically prunes expired keys (`expires_at < NOW()`).
* **Keyset Pagination (`updated_at DESC, id DESC`):**
  - Offset pagination (`OFFSET 10000`) degrades to $O(N)$ scanning and causes missing or duplicate rows when items are updated mid-browse.
  - Keyset pagination constrains the query with `(updated_at, id) < ($cursor_updated_at, $cursor_id)`, achieving constant-time $O(\log N)$ index seeks via the composite index `(team_id, updated_at DESC, id DESC)`.
  - Limits are strictly clamped between 1 and 100.
* **PostgreSQL Full-Text Search (`search_vector` + GIN Index):**
  - Generated stored column `search_vector TSVECTOR` combining `title` and `description` with English stemming.
  - Indexed with a GIN index (`idx_items_search`).
  - Search queries execute with `search_vector @@ plainto_tsquery('english', $query)` without loading rows into Node.js memory.
  - Avoids maintaining Elasticsearch or OpenSearch clusters for single-node to moderate multi-node deployments.

### What Wasn't Built (Intentional Trade-offs & Limitations)
1. **Outbox Purging:** Because notifications reference `outbox_events(id)` via foreign key, outbox records are not deleted immediately after processing. In a production cluster, notifications could reference the event ID as a UUID without a hard FK constraint, allowing partition truncation of historical outbox logs.
2. **Search Rank Sorting in Keyset Pagination:** Searching currently orders by `updated_at DESC, id DESC` to maintain cursor stability rather than text relevance rank (`ts_rank`), as cursor pagination over relevance scores can result in unstable tie-breaking.
3. **No WebSockets / Server-Sent Events:** Real-time updates are deferred in favor of a clean REST polling interface and reliable worker notification persistence.
