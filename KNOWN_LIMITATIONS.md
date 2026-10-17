# OpsDesk — Known Limitations & Scaling Strategy

This document transparently outlines the known architectural boundaries, intentional trade-offs, and operational bottlenecks of the current OpsDesk implementation, along with concrete steps for scaling to 100x traffic.

---

## 1. Known Architectural Limitations

### 1.1 Outbox Table Accumulation & Partitioning
- **Current Behavior:** Outbox events remain in the `outbox_events` table after transitioning to `PROCESSED` or `DEAD`.
- **Constraint:** `notifications.event_id` holds a foreign key referencing `outbox_events(id)`. Because of this constraint, simple `DELETE` or `TRUNCATE` operations on historical outbox events require cascading deletes.
- **Production Solution:** Remove the hard foreign key constraint in production schemas, retaining `event_id UUID` as a logical reference. Implement PostgreSQL table partitioning by month (`PARTITION BY RANGE (created_at)`), allowing automated dropping of partitions older than 90 days in constant time without table locks.

### 1.2 Keyset Pagination vs. Arbitrary Page Jumping
- **Current Behavior:** Pagination uses keyset cursors (`updated_at DESC, id DESC`). This guarantees $O(\log N)$ performance and prevents missing or duplicated rows.
- **Limitation:** Operators cannot directly click "Jump to Page 50". Keyset pagination requires forward and backward cursor traversal.
- **Production Solution:** For operational desk workflows, keyset pagination matches the dominant usage pattern (scrolling/triaging the most recently updated items). Where random page access is required, a hybrid windowed count can be exposed for shallow pages.

### 1.3 Full-Text Search Relevance vs. Cursor Stability
- **Current Behavior:** Work-item searches query PostgreSQL's native `search_vector` GIN index, ordered by `wi.updated_at DESC, wi.id DESC`.
- **Limitation:** Ordering by update time rather than text relevance rank (`ts_rank`) ensures cursor stability across pagination, but may place exact phrase matches with older update timestamps below newer partial matches.
- **Production Solution:** At 100x scale, offload full-text search to Elasticsearch or OpenSearch via outbox event CDC (Change Data Capture), where relevance scoring and faceted navigation are natively decoupled from relational cursor state.

### 1.4 Single-Node Database Scalability
- **Current Behavior:** All transactional writes, queries, and outbox operations run on a single primary PostgreSQL instance.
- **Limit:** A single database instance with appropriate SSD NVMe storage typically supports up to ~5,000–10,000 writes/sec and tens of thousands of reads/sec with connection pooling (`pgbouncer`).
- **Production Scaling (100x Scale):**
  1. **Read Replicas:** Route heavy read queries (dashboard metrics aggregation, full-text search, audit history browsing) to read replicas, reserving the primary strictly for transactional mutations and outbox claiming.
  2. **Connection Pooling:** Introduce `pgBouncer` in transaction pooling mode to scale concurrent client connections to 10,000+.
  3. **Multi-Region Tenant Sharding:** Shard the `work_items` and `teams` tables by `team_id` across database clusters.

### 1.5 Real-Time Communication
- **Current Behavior:** Updates and notifications poll at intervals (Dashboard: 15s; Detail page: 10s; Notifications: 8s).
- **Limitation:** Updates are near real-time, but not sub-second push.
- **Production Solution:** Connect the outbox worker to a WebSocket or Server-Sent Events (SSE) gateway (e.g. AWS API Gateway WebSocket or Centrifugo) to broadcast instant push notifications upon processing.

---

## 2. Worker Failure & Recovery Modes

| Scenario | System Behavior | Recovery Mechanism |
| :--- | :--- | :--- |
| **Worker process crashes mid-batch** | Events remain in `PROCESSING` status with `locked_at` timestamp. | On next poll cycle, `recoverStaleEvents()` reclaims any event stuck in `PROCESSING` for >60 seconds and resets status to `PENDING`. |
| **Database connection drops** | Worker enters error handler, logs diagnostic, sleeps for `OUTBOX_POLL_INTERVAL_MS`, and retries. | Connection pool automatically reconnects when database recovers. |
| **Poison-pill / malformed event payload** | Event fails processing, attempt counter increments, error logged to `last_error`. | Exponential backoff delay ($2, 4, 8, 16\text{s}$). After 5 attempts, transitions to `DEAD` status (Dead Letter Queue) so remaining queue is never blocked. |
| **Two workers running concurrently** | Row-level locking with `FOR UPDATE SKIP LOCKED`. | Zero contention. Workers claim non-overlapping slices of the outbox table. |

---

## 3. What We Would Build Next Week

1. **SLA Timers & Automated Escalations:** Configure customizable resolution SLA countdowns per team and priority (e.g. P0: 1 hour, P1: 4 hours) with automated outbox escalation notifications when SLAs breach.
2. **Saved Filter Views & Quick Filters:** Allow operators to save custom filter presets ("My High Priority Items", "Pending Payment Approvals") to their personal sidebar.
3. **Rich Markdown & Attachment Support:** Add S3-compatible pre-signed upload URLs for attaching logs, error screenshots, and diagnostic receipts to work items.
4. **Role Management & Team Invitation UI:** Admin screen to invite colleagues by email and configure team roles directly in the application.
