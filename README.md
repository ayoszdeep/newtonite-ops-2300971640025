# OpsDesk — Enterprise Operational Desk Backend

OpsDesk is an enterprise operations backend written in Node.js, Express 5, TypeScript, and PostgreSQL (`pg`). It provides authentication, role-based team permissions, concurrent-update protection, approval workflows, append-only audit histories, and a transactional outbox background worker with in-app notifications.

---

## Features

- **Authentication & RBAC:** JWT authentication (`HS256`), bcrypt password hashing (cost 10), timing-attack resistance on login, user deactivation checks on every request, and team-scoped roles (`viewer`, `member`, `lead`).
- **Concurrent-Update Protection:** Optimistic concurrency control via `version` column, row-locking transactions (`SELECT ... FOR UPDATE`), and atomic conditional `UPDATE` statements for racing claims.
- **Workflow State Machine:** Strict transitions (`OPEN → IN_PROGRESS → PENDING_APPROVAL → APPROVED/REJECTED → RESOLVED → CLOSED`), approval enforcement for flagged items, and self-approval prevention.
- **Transactional Outbox Worker:** Decoupled background notification system using PostgreSQL `FOR UPDATE SKIP LOCKED`, lease recovery for crashed workers, exponential backoff retries, dead-letter handling, and database-enforced notification deduplication (`UNIQUE(event_id, user_id)`).
- **Idempotency Keys:** Request deduplication for creations, comments, and state transitions using `Idempotency-Key` headers with SHA-256 canonical payload hashing.
- **Search & Keyset Pagination:** PostgreSQL full-text search (`TSVECTOR` + GIN indexing) combined with constant-time keyset cursor pagination (`updated_at DESC, id DESC`).
- **Dashboard Aggregations:** Database-level queries for assigned items, unassigned high-priority tasks (P0/P1), pending approvals, and overdue work items.

---

## Project Structure

```
OpsDesk/
├── docker-compose.yml           # PostgreSQL, API, and Worker containers
├── DECISIONS.md                 # 5 Key architectural decisions
├── README.md                    # Project documentation
└── api/
    ├── Dockerfile               # Production multi-stage Docker build
    ├── package.json             # Scripts & dependencies
    ├── tsconfig.json            # TypeScript configuration
    ├── .env                     # Local environment variables
    ├── .env.example             # Environment template
    └── src/
        ├── app.ts               # Express configuration & middleware
        ├── index.ts             # API entrypoint
        ├── worker.ts            # Outbox background worker
        ├── config/
        │   └── env.ts           # Zod-validated environment config
        ├── db/
        │   ├── pool.ts          # pg Connection pool
        │   ├── transaction.ts   # Reusable withTransaction helper
        │   ├── migrate.ts       # Migration runner
        │   ├── seed.ts          # Demo data & 20k bulk items generator
        │   └── migrations/
        │       └── 001_init.sql # Database schema & indexes
        ├── middleware/
        │   ├── authenticate.ts  # JWT verification & active user check
        │   ├── authorizeTeam.ts # Team role-based access control
        │   └── errorHandler.ts  # Centralized error handler with error codes
        ├── routes/
        │   ├── auth.routes.ts   # /api/auth (login, me)
        │   ├── teams.routes.ts  # /api/teams (list, details, members)
        │   ├── items.routes.ts  # /api/items (CRUD, claim, assign, transition, comments)
        │   ├── approvals.routes.ts # /api/approvals (pending, approve, reject)
        │   ├── dashboard.routes.ts # /api/dashboard (counts and summaries)
        │   └── notifications.routes.ts # /api/notifications (list, mark read)
        ├── services/
        │   ├── auth.service.ts
        │   ├── items.service.ts
        │   ├── workflow.service.ts
        │   ├── approvals.service.ts
        │   ├── audit.service.ts
        │   ├── idempotency.service.ts
        │   ├── outbox.service.ts
        │   └── notifications.service.ts
        ├── types/
        │   └── express.d.ts     # Express Request type extensions
        └── utils/
            └── HttpError.ts     # Application error class with codes
```

---

## Getting Started

### 1. Prerequisites
- Node.js 20+
- Docker & Docker Compose (or a local PostgreSQL 16+ instance)

### 2. Configure Environment
In `api/.env`:
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

### 3. Start Database
```bash
docker compose up -d db
```

### 4. Run Migrations & Seed
From `api/`:
```bash
npm run migrate
npm run seed
```

### 5. Start API & Worker
In Terminal 1 (API):
```bash
npm run dev
```

In Terminal 2 (Background Worker):
```bash
npm run dev:worker
```

The API runs on `http://localhost:4000`. Health check:
```bash
GET http://localhost:4000/api/health
```

---

## Seed Accounts

All seed users have the password: `password123`

| Email | Name | Teams & Roles |
|---|---|---|
| `alice@opsdesk.dev` | Alice Johnson | Payments (**Lead**), Compliance (Member) |
| `bob@opsdesk.dev` | Bob Smith | Payments (Member), Engineering (Member) |
| `charlie@opsdesk.dev` | Charlie Brown | Payments (Member) |
| `diana@opsdesk.dev` | Diana Prince | Payments (Viewer) |
| `eve@opsdesk.dev` | Eve Wilson | Engineering (**Lead**) |
| `frank@opsdesk.dev` | Frank Miller | Engineering (Member) |
| `grace@opsdesk.dev` | Grace Lee | Engineering (Member) |
| `henry@opsdesk.dev` | Henry Davis | Compliance (**Lead**) |
| `ivy@opsdesk.dev` | Ivy Chen | Compliance (Member) |
| `jack@opsdesk.dev` | Jack Taylor | Compliance (Member) |

---

## API Endpoints Reference

### Auth
- `POST /api/auth/login` — Log in with email & password (rate-limited, anti-enumeration)
- `GET /api/auth/me` — Return current user details & team memberships

### Teams
- `GET /api/teams` — List teams user belongs to
- `GET /api/teams/:id` — Get team details & user's role (404 if not a member)
- `GET /api/teams/:id/members` — List members & roles for a team

### Work Items
- `GET /api/items` — Keyset-paginated search & filter (`teamId`, `status`, `priority`, `assigneeId`, `type`, `search`, `limit`, `cursor`)
- `POST /api/items` — Create item (`Idempotency-Key` required)
- `GET /api/items/:id` — Get item details + calculated UI permissions
- `PATCH /api/items/:id` — Optimistic update (`expectedVersion` required)
- `POST /api/items/:id/claim` — Atomic claim (idempotent for current owner)
- `POST /api/items/:id/assign` — Assign item to team member (`expectedVersion` required)
- `POST /api/items/:id/unassign` — Release claim (`expectedVersion` required; assignee or lead only)
- `POST /api/items/:id/transition` — Status transition (`expectedVersion`, `Idempotency-Key` required)
- `POST /api/items/:id/comments` — Add comment (`Idempotency-Key` required, does not bump version)
- `GET /api/items/:id/comments` — Keyset-paginated comment stream
- `GET /api/items/:id/activity` — Keyset-paginated append-only audit trail

### Approvals
- `GET /api/approvals/pending` — List pending approvals for teams caller leads (excludes self-requests)
- `POST /api/approvals/:id/approve` — Approve request (`expectedVersion` required)
- `POST /api/approvals/:id/reject` — Reject request (`expectedVersion`, `reason` required)

### Dashboard
- `GET /api/dashboard` — Aggregated counts and lists for assigned, unassigned high-priority, pending approvals, and overdue items

### Notifications
- `GET /api/notifications` — List notifications with unread count
- `POST /api/notifications/:id/read` — Mark notification as read
- `POST /api/notifications/read-all` — Mark all notifications as read
