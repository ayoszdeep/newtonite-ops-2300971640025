CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE team_memberships (
    user_id UUID NOT NULL REFERENCES users(id),
    team_id UUID NOT NULL REFERENCES teams(id),
    role TEXT NOT NULL CHECK (
        role IN ('viewer', 'member', 'lead')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, team_id)
);

CREATE TABLE work_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id),
    type TEXT NOT NULL CHECK (
        type IN ('incident', 'payment', 'compliance', 'task')
    ),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (
        status IN (
            'OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL',
            'APPROVED', 'REJECTED', 'RESOLVED', 'CLOSED'
        )
    ),
    priority TEXT NOT NULL DEFAULT 'P2' CHECK (
        priority IN ('P0', 'P1', 'P2', 'P3')
    ),
    assignee_id UUID,
    created_by UUID NOT NULL REFERENCES users(id),
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    due_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector(
            'english',
            coalesce(title, '') || ' ' || coalesce(description, '')
        )
    ) STORED,

    FOREIGN KEY (assignee_id, team_id)
        REFERENCES team_memberships(user_id, team_id)
);

CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES work_items(id),
    user_id UUID NOT NULL REFERENCES users(id),
    body TEXT NOT NULL CHECK (
        length(trim(body)) BETWEEN 1 AND 10000
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES work_items(id),
    actor_id UUID NOT NULL REFERENCES users(id),
    event_type TEXT NOT NULL,
    before_data JSONB,
    after_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES work_items(id),
    requested_by UUID NOT NULL REFERENCES users(id),
    decided_by UUID REFERENCES users(id),
    decision TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (decision IN ('PENDING', 'APPROVED', 'REJECTED')),
    reason TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_one_pending_approval_per_item
ON approvals(item_id)
WHERE decision = 'PENDING';

CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
        DEFAULT (NOW() + INTERVAL '24 hours'),
    UNIQUE(user_id, key)
);

CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'DEAD')
        ),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES outbox_events(id),
    user_id UUID NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    item_id UUID REFERENCES work_items(id),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(event_id, user_id)
);

-- Primary query indexes
CREATE INDEX idx_items_team_status_priority_updated
ON work_items(team_id, status, priority, updated_at DESC, id DESC);

CREATE INDEX idx_items_assignee_status
ON work_items(assignee_id, status);

CREATE INDEX idx_items_search
ON work_items USING GIN(search_vector);

CREATE INDEX idx_comments_item_created
ON comments(item_id, created_at DESC, id DESC);

CREATE INDEX idx_activity_item_created
ON activity_events(item_id, created_at DESC, id DESC);

CREATE INDEX idx_approvals_pending
ON approvals(decision, requested_at DESC);

CREATE INDEX idx_outbox_available
ON outbox_events(available_at, created_at)
WHERE status = 'PENDING';

CREATE INDEX idx_notifications_user_created
ON notifications(user_id, created_at DESC, id DESC);

-- Additional indexes for common list queries (bug fix #6)
CREATE INDEX idx_items_team_updated
ON work_items(team_id, updated_at DESC, id DESC);

CREATE INDEX idx_items_assignee_updated
ON work_items(assignee_id, updated_at DESC, id DESC);

CREATE INDEX idx_items_overdue
ON work_items(due_at)
WHERE status NOT IN ('RESOLVED', 'CLOSED');

CREATE INDEX idx_outbox_processing
ON outbox_events(locked_at)
WHERE status = 'PROCESSING';
