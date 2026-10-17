# newtonite-ops-2300971640025

# OpsDesk — Enterprise Operational Desk & Workflow System

OpsDesk is an internal web application designed to create, assign, track, and resolve high-stakes operational work items across teams under pressure. It provides concurrency-safe state transitions, team-scoped role-based authorization, optimistic UI updates with conflict resolution, append-only audit histories, and a resilient transactional outbox worker for background notifications.

---

## Architecture Diagram

```mermaid
flowchart TD
    subgraph Client["Web Frontend (React 19 + Vite + TanStack Query)"]
        UI["Linear-style UI & Dashboard"]
        OccHandler["Optimistic UI & 409 Conflict Resolver"]
        Polling["Live Polling Engine (8s / 10s / 15s)"]
    end

    subgraph API["Backend API (Node.js + Express 5 + TypeScript)"]
        AuthMiddleware["JWT Authenticate & Active Check"]
        RBAC["Team-Scoped RBAC & 404 Privacy Guard"]
        StateMachine["Workflow State Machine & Idempotency Filter"]
        TxManager["Atomic Transaction Manager (pg pool)"]
    end

    subgraph DB["PostgreSQL 17 Database"]
        WorkItems[("work_items (versioned)")]
        AuditEvents[("activity_events (append-only)")]
        Approvals[("approvals (one-pending index)")]
        OutboxTable[("outbox_events (transactional)")]
        Notifications[("notifications (UNIQUE event+user)")]
    end

    subgraph WorkerService["Background Worker Daemon"]
        SkipLocked["FOR UPDATE SKIP LOCKED Poller"]
        RetryEngine["Exponential Backoff & Dead Letter Queue"]
        LeaseRecovery["Crash Recovery (60s Lock TTL)"]
    end

    UI -->|HTTPS / REST + Idempotency-Key| AuthMiddleware
    AuthMiddleware --> RBAC
    RBAC --> StateMachine
    StateMachine --> TxManager
    TxManager -->|Atomic COMMIT / ROLLBACK| WorkItems
    TxManager --> AuditEvents
    TxManager --> Approvals
    TxManager --> OutboxTable

    WorkerService -->|Polls pending events| OutboxTable
    WorkerService -->|Inserts deduplicated alerts| Notifications
    Polling -->|Fetches live notifications| Notifications
    OccHandler <-->|Version validation & Stale checks| WorkItems
```

---

## Prerequisites

- **Node.js**: v20+ (`node -v`)
- **Docker & Docker Compose**: Docker Desktop running (`docker compose version`)
- **Package Manager**: `npm`

---

## Exact Run Commands

### Option 1: Full Docker Compose Run (API + Worker + DB)
```bash
# From repository root:
docker compose up -d

# Run migrations and seed data in API:
cd api
npm install
npm run migrate
npm run seed

# Run the web frontend:
cd ../web
npm install
npm run dev
```
- Web UI: **http://localhost:5173**
- Backend API: **http://localhost:4000/api**

### Option 2: Local Development Run (Fastest for Development)
```bash
# 1. Start PostgreSQL Database
docker compose up -d db

# 2. Setup and run Backend API (Terminal 1)
cd api
npm install
npm run migrate
npm run seed
npm run dev

# 3. Run Outbox Background Worker (Terminal 2)
cd api
npm run dev:worker

# 4. Run Frontend Dashboard (Terminal 3)
cd web
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Demo Login Credentials per Role

All seed users use the password: **`password123`**

The login screen also includes **1-Click Quick Sign-In buttons** for instant persona switching.

| Role | Email | Password | Assigned Team | Permissions / Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| **Team Lead** | `lead@opsdesk.dev` | `password123` | Payments | Can create, assign, unassign, edit, transition, and **approve/reject** requests. |
| **Team Member 1** | `member@opsdesk.dev` | `password123` | Payments | Can create, claim, assign, transition, and comment. Cannot approve. |
| **Team Member 2** | `member2@opsdesk.dev` | `password123` | Payments | Can create, claim, assign, transition, and comment. |
| **Viewer** | `viewer@opsdesk.dev` | `password123` | Payments | **Read-only**. Action buttons hidden; direct API mutations return 403. |
| **Outsider** | `outsider@opsdesk.dev` | `password123` | Engineering | Belongs to another team. Accessing Payments items returns **404 Not Found**. |

---

## How to Run Automated Tests

The automated smoke suite runs **143 tests** covering identity, RBAC authorization, claim races, version conflicts, workflow rules, idempotency, keyset pagination, 20k performance benchmarks, and outbox notification delivery.

```bash
cd api
npx tsx scripts/smoke.ts
```

Expected result:
```
━━━━━━━━━━ SUMMARY ━━━━━━━━━━
✅  2/2   0. Basics
✅ 14/14  1. Authentication
✅  6/6   2. Teams & membership
✅ 18/18  3. Authorization (enforced by API, not UI)
✅  8/8   4. Idempotency (retries don't duplicate)
✅  4/4   5. Comments
✅  8/8   6. Stale updates (optimistic concurrency)
✅  6/6   7. Claim race (two people grabbing the same work)
✅ 11/11  8. Workflow rules
✅ 19/19  9. Approvals
✅ 11/11  10. Audit history
✅ 14/14  11. List, filter, search, pagination
✅  5/5   12. Performance with seeded data
✅  7/7   13. Dashboard
✅ 10/10  14. Background worker & notifications

143/143 checks passed
```

### Type Checking & Build Verification
```bash
# In api/:
npm run build    # 0 errors

# In web/:
npm run build    # 0 errors
```

---

## Key Non-CRUD Behaviors Implemented

1. **Atomic Claim Races:** Single-statement conditional `UPDATE ... WHERE assignee_id IS NULL` guarantees only one operator wins a race, with idempotent success for the existing owner and `409 ALREADY_CLAIMED` for others.
2. **Optimistic Concurrency Control:** Every state change requires `expectedVersion`. Concurrent edits reject with `409 VERSION_CONFLICT` and present a visual conflict modal preserving the user's unsaved draft.
3. **Cryptographic Idempotency:** Mutations accept an `Idempotency-Key` header with SHA-256 request canonicalization. Identical network retries return the cached response; modified bodies return `422 IDEMPOTENCY_KEY_REUSED`.
4. **Enforced Workflow Transitions:** Validates state machine rules (`OPEN → IN_PROGRESS → PENDING_APPROVAL → APPROVED/REJECTED → RESOLVED → CLOSED`). Items requiring approval cannot bypass the approval stage.
5. **Self-Approval Prevention:** Team leads cannot approve or reject their own requested approvals.
6. **Append-Only Audit History:** Immutable `activity_events` ledger recording actor, event type, and before/after diffs.
7. **Transactional Outbox Worker:** `FOR UPDATE SKIP LOCKED` batch processor with exponential retry backoff, dead-letter queueing, and stale lease recovery.
8. **Keyset Cursor Pagination & Full-Text Search:** $O(\log N)$ cursor seeks over 20,000 seeded items with PostgreSQL GIN indexed `TSVECTOR` searching.

---

## Documentation Links

- [ENGINEERING_DECISIONS.md](file:///c:/Users/22ayo/Desktop/Newnoite/OpsDesk/ENGINEERING_DECISIONS.md) — Detailed rationale for concurrency, outbox pattern, RBAC, and idempotency.
- [KNOWN_LIMITATIONS.md](file:///c:/Users/22ayo/Desktop/Newnoite/OpsDesk/KNOWN_LIMITATIONS.md) — Analysis of scaling bottlenecks, outbox accumulation, and 100x scale roadmap.

---

## Next Week I Would...

1. **Configurable SLA Countdown Timers:** Add team-specific SLA policies with automated visual urgency indicators and outbox escalation alerts when items approach breach thresholds.
2. **Saved Query Views & Custom Presets:** Allow operators to bookmark complex filter queries (e.g. "My P0 Unresolved Incidents") directly in their sidebar.
3. **Attachments via S3 Pre-Signed URLs:** Implement direct-to-object-storage attachments for log files, diagnostics, and screenshots.
4. **WebSockets / SSE Gateway:** Upgrade the polling engine to push-based notification delivery via a lightweight WebSocket broker connected to the outbox worker.
