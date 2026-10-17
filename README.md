# newtonite-ops-2300971640025

# OpsDesk — Enterprise Operational Desk & Workflow System

OpsDesk is an internal web application designed to create, assign, track, and resolve high-stakes operational work items across teams under pressure. It provides concurrency-safe state transitions, team-scoped role-based authorization, optimistic UI updates with conflict resolution, append-only audit histories, and a resilient transactional outbox worker for background notifications.

---

## Architecture Diagram

```mermaid
flowchart TD
    subgraph Client["Web Frontend (React 19 + Vite + TanStack Query)"]
        UI["Linear-style SaaS UI & Dashboard"]
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

## Ports & Services Reference

| Service | Port | Description |
| :--- | :--- | :--- |
| **Web Frontend** | `5173` | React 19 + Vite dashboard (`http://localhost:5173`) |
| **API Server** | `4000` | Node.js + Express 5 REST API (`http://localhost:4000/api`) |
| **PostgreSQL DB** | `5432` / `5433` | PostgreSQL 17 container (`5433` mapped if 5432 in use locally) |
| **Outbox Worker** | Background process | Daemon polling `outbox_events` every 1000ms |

---

## Prerequisites

- **Node.js**: v20+ (`node -v`)
- **Docker & Docker Compose**: Docker Desktop running (`docker compose version`)
- **Package Manager**: `npm`

---

## Environment Variables

### Backend (`api/.env`)
```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://opsdesk:local_dev_password@localhost:5432/opsdesk
JWT_SECRET=8b9925f95f840e0e57298be8d949af436951e7117b0296eaa8d36ba9f644c085
JWT_EXPIRES_IN=1h
WEB_ORIGIN=http://localhost:5173
OUTBOX_BATCH_SIZE=10
OUTBOX_MAX_ATTEMPTS=5
OUTBOX_POLL_INTERVAL_MS=1000
```
*(If local PostgreSQL uses port 5433, change `DATABASE_URL` to `localhost:5433`)*

### Frontend (`web/.env`)
```env
VITE_API_URL=http://localhost:4000/api
```

---

## Exact Run Commands

### Option 1: Full Docker Compose Run
```bash
# 1. Start all containerized services:
docker compose up -d

# 2. Run migrations and seed data in API:
cd api
npm install
npm run migrate
npm run seed

# 3. Start the web frontend:
cd ../web
npm install
npm run dev
```

### Option 2: Local Development Run (Fastest)
```bash
# 1. Start PostgreSQL Database:
docker compose up -d db

# 2. Run migrations & seed data:
cd api
npm install
npm run migrate
npm run seed

# 3. Start API Server (Terminal 1):
npm run dev

# 4. Start Background Worker (Terminal 2):
npm run dev:worker

# 5. Start Web Dashboard (Terminal 3):
cd ../web
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Demo Login Credentials per Role

All seed users use the password: **`password123`**

The login screen includes **1-Click Quick Sign-In buttons** for instant persona switching.

| Role | Email | Password | Assigned Team | Permissions / Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| **Team Lead** | `lead@opsdesk.dev` | `password123` | Payments | Can create, assign, unassign, edit, transition, and **approve/reject** requests. |
| **Team Member 1** | `member@opsdesk.dev` | `password123` | Payments | Can create, claim, assign, transition, and comment. Cannot approve. |
| **Team Member 2** | `member2@opsdesk.dev` | `password123` | Payments | Can create, claim, assign, transition, and comment. |
| **Viewer** | `viewer@opsdesk.dev` | `password123` | Payments | **Read-only**. Action buttons hidden; direct API mutations return 403. |
| **Outsider** | `outsider@opsdesk.dev` | `password123` | Engineering | Belongs to another team. Accessing Payments items returns **404 Not Found**. |

---

## How to Run Automated Tests

### 1. Run the Smoke Test Suite (143 Tests)
The automated smoke suite runs **143 tests** covering identity, RBAC authorization, claim races, version conflicts, workflow rules, idempotency, keyset pagination, 20k performance benchmarks, and outbox notification delivery.

```bash
cd api
npm run test:smoke
# Or: npx tsx scripts/smoke.ts
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

### 2. Type Checking & Production Build Verification
```bash
# In api/:
npm run build    # 0 errors

# In web/:
npm run build    # 0 errors
```

---

## Assumptions Made

As requested by the hiring brief, here are the explicit product and engineering assumptions:
1. **Team Scoping:** Every work item belongs to exactly one team (`team_id`). Cross-team work items are not permitted; if work transitions to another team, a new work item must be created.
2. **Team Roles vs. Global Roles:** Roles (`viewer`, `member`, `lead`) are strictly scoped per team in `team_memberships`. A user can be a `lead` in Payments but a `viewer` in Engineering.
3. **Approval Requirements:** Not all work items require lead approval; only items with `requires_approval = true` require sign-off before they can transition to `RESOLVED`.
4. **Self-Approval Prohibition:** A team lead who requested approval on a work item cannot approve or reject their own request. Another lead on that team must review it.
5. **No External Communications:** Email notifications, SMS, webhooks, and third-party SSO are intentionally out of scope in favor of an auditable in-app transactional notification feed.
6. **Immutable Audit History:** Activity events are strictly append-only. There are no API routes or database functions to edit or delete history events.

---

## Risk-Based Testing Strategy

Our automated tests intentionally target high-risk operational failure modes:
- **Claim Races (High Risk):** 10 parallel claims by 2 users tested simultaneously to verify only 1 user wins and exactly 1 audit event is recorded.
- **Stale Overwrites (High Risk):** Parallel updates with identical `expectedVersion` verified to ensure 1 succeeds and the other receives `409 VERSION_CONFLICT` with current state.
- **Network Retries & Double-Clicks (High Risk):** 6 parallel duplicate requests with identical `Idempotency-Key` headers tested to verify exactly 1 record is created.
- **Authorization Bypass (High Risk):** Viewer and outsider accounts subjected to direct curl/fetch mutations (claim, transition, comment, create) to prove enforcement is server-side and foreign teams return 404.
- **Worker Crash Recovery & Poison Events (High Risk):** Stale processing events (>60s lease) automatically reclaimed; malformed events retry up to 5 times with exponential backoff before landing in `DEAD`.

---

## Troubleshooting

- **`Port 5432 already in use`:**
  If you have a local PostgreSQL server on port 5432, run `docker compose up -d` (which maps container port 5432 to host port 5433). Update `DATABASE_URL` in `api/.env` to `postgresql://opsdesk:local_dev_password@localhost:5433/opsdesk`.
- **`Database connection refused`:**
  Check that the database container is healthy: `docker compose ps`. Wait 5 seconds for PostgreSQL initialization.
- **`Token expired or 401 Unauthorized`:**
  JWT tokens expire after 1 hour (`JWT_EXPIRES_IN=1h`). The frontend will automatically redirect you to `/login?expired=1`. Simply click any demo login button to re-authenticate.
- **`TypeScript build errors`:**
  Ensure you have Node.js 20+ installed. Run `npm run build` in both `api/` and `web/`.

---

## Documentation Links

- [ENGINEERING_DECISIONS.md](file:///c:/Users/22ayo/Desktop/Newnoite/OpsDesk/ENGINEERING_DECISIONS.md) — 6 core architectural decisions with alternatives considered and trade-offs.
- [KNOWN_LIMITATIONS.md](file:///c:/Users/22ayo/Desktop/Newnoite/OpsDesk/KNOWN_LIMITATIONS.md) — Production bottlenecks, worker failure modes, and 100x scaling strategy.

---

## Next Week I Would...

1. **Configurable SLA Countdown Timers:** Add team-specific SLA policies with automated visual urgency indicators and outbox escalation alerts when items approach breach thresholds.
2. **Saved Query Views & Custom Presets:** Allow operators to bookmark complex filter queries (e.g. "My P0 Unresolved Incidents") directly in their sidebar.
3. **Attachments via S3 Pre-Signed URLs:** Implement direct-to-object-storage attachments for log files, diagnostics, and screenshots.
4. **WebSockets / SSE Gateway:** Upgrade the polling engine to push-based notification delivery via a lightweight WebSocket broker connected to the outbox worker.
