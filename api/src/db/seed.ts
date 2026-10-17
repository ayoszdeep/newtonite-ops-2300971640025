import "dotenv/config";
import bcrypt from "bcrypt";
import { pool } from "./pool";

const BCRYPT_ROUNDS = 10;

interface User {
  id?: string;
  name: string;
  email: string;
  password: string;
}

interface Team {
  id?: string;
  name: string;
  slug: string;
}

async function seed() {
  console.log("Seeding database...");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Clean existing data in reverse dependency order
    await client.query("DELETE FROM notifications");
    await client.query("DELETE FROM outbox_events");
    await client.query("DELETE FROM idempotency_keys");
    await client.query("DELETE FROM activity_events");
    await client.query("DELETE FROM approvals");
    await client.query("DELETE FROM comments");
    await client.query("DELETE FROM work_items");
    await client.query("DELETE FROM team_memberships");
    await client.query("DELETE FROM teams");
    await client.query("DELETE FROM users");

    // Create users
    const users: User[] = [
      { name: "Alice Johnson", email: "alice@opsdesk.dev", password: "password123" },
      { name: "Bob Smith", email: "bob@opsdesk.dev", password: "password123" },
      { name: "Charlie Brown", email: "charlie@opsdesk.dev", password: "password123" },
      { name: "Diana Prince", email: "diana@opsdesk.dev", password: "password123" },
      { name: "Eve Wilson", email: "eve@opsdesk.dev", password: "password123" },
      { name: "Frank Miller", email: "frank@opsdesk.dev", password: "password123" },
      { name: "Grace Lee", email: "grace@opsdesk.dev", password: "password123" },
      { name: "Henry Davis", email: "henry@opsdesk.dev", password: "password123" },
      { name: "Ivy Chen", email: "ivy@opsdesk.dev", password: "password123" },
      { name: "Jack Taylor", email: "jack@opsdesk.dev", password: "password123" },
      // Smoke test users
      { name: "Team Lead", email: "lead@opsdesk.dev", password: "password123" },
      { name: "Team Member", email: "member@opsdesk.dev", password: "password123" },
      { name: "Team Member 2", email: "member2@opsdesk.dev", password: "password123" },
      { name: "Team Viewer", email: "viewer@opsdesk.dev", password: "password123" },
      { name: "Outsider User", email: "outsider@opsdesk.dev", password: "password123" },
    ];

    const userIds: string[] = [];
    for (const user of users) {
      const hash = await bcrypt.hash(user.password, BCRYPT_ROUNDS);
      const result = await client.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [user.name, user.email.toLowerCase(), hash]
      );
      userIds.push(result.rows[0].id);
    }

    console.log(`  Created ${userIds.length} users`);

    // Create teams
    const teams: Team[] = [
      { name: "Payments", slug: "payments" },
      { name: "Engineering", slug: "engineering" },
      { name: "Compliance", slug: "compliance" },
    ];

    const teamIds: string[] = [];
    for (const team of teams) {
      const result = await client.query(
        `INSERT INTO teams (name, slug) VALUES ($1, $2) RETURNING id`,
        [team.name, team.slug]
      );
      teamIds.push(result.rows[0].id);
    }

    console.log(`  Created ${teamIds.length} teams`);

    // Team memberships
    // Payments team: Alice (lead), Bob (member), Charlie (member), Diana (viewer)
    // Engineering team: Eve (lead), Frank (member), Grace (member), Bob (member)
    // Compliance team: Henry (lead), Ivy (member), Jack (member), Alice (member)
    const memberships = [
      // Payments
      { userId: userIds[0], teamId: teamIds[0], role: "lead" },    // Alice - lead
      { userId: userIds[1], teamId: teamIds[0], role: "member" },  // Bob - member
      { userId: userIds[2], teamId: teamIds[0], role: "member" },  // Charlie - member
      { userId: userIds[3], teamId: teamIds[0], role: "viewer" },  // Diana - viewer
      // Engineering
      { userId: userIds[4], teamId: teamIds[1], role: "lead" },    // Eve - lead
      { userId: userIds[5], teamId: teamIds[1], role: "member" },  // Frank - member
      { userId: userIds[6], teamId: teamIds[1], role: "member" },  // Grace - member
      { userId: userIds[1], teamId: teamIds[1], role: "member" },  // Bob - member (cross-team)
      // Compliance
      { userId: userIds[7], teamId: teamIds[2], role: "lead" },    // Henry - lead
      { userId: userIds[8], teamId: teamIds[2], role: "member" },  // Ivy - member
      { userId: userIds[9], teamId: teamIds[2], role: "member" },  // Jack - member
      { userId: userIds[0], teamId: teamIds[2], role: "member" },  // Alice - member (cross-team)
      // Smoke test users
      { userId: userIds[10], teamId: teamIds[0], role: "lead" },   // lead@opsdesk.dev -> Payments (lead)
      { userId: userIds[11], teamId: teamIds[0], role: "member" }, // member@opsdesk.dev -> Payments (member)
      { userId: userIds[12], teamId: teamIds[0], role: "member" }, // member2@opsdesk.dev -> Payments (member)
      { userId: userIds[13], teamId: teamIds[0], role: "viewer" }, // viewer@opsdesk.dev -> Payments (viewer)
      { userId: userIds[14], teamId: teamIds[1], role: "member" }, // outsider@opsdesk.dev -> Engineering (member)
    ];

    for (const m of memberships) {
      await client.query(
        `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, $3)`,
        [m.userId, m.teamId, m.role]
      );
    }

    console.log(`  Created ${memberships.length} team memberships`);

    // Create sample work items
    const itemTypes = ["incident", "payment", "compliance", "task"] as const;
    const statuses = ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL", "APPROVED", "REJECTED", "RESOLVED", "CLOSED"] as const;
    const priorities = ["P0", "P1", "P2", "P3"] as const;

    const sampleItems = [
      // Payments team items
      { teamId: teamIds[0], type: "payment", title: "Investigate failed customer payment #4521", description: "Customer reports amount was deducted but order not confirmed.", priority: "P1", status: "OPEN", createdBy: userIds[1], requiresApproval: true },
      { teamId: teamIds[0], type: "payment", title: "Process refund for order #8832", description: "Customer requested refund for damaged goods.", priority: "P2", status: "IN_PROGRESS", createdBy: userIds[2], assigneeId: userIds[1], requiresApproval: true },
      { teamId: teamIds[0], type: "incident", title: "Payment gateway timeout errors", description: "Multiple customers experiencing timeout during checkout.", priority: "P0", status: "IN_PROGRESS", createdBy: userIds[0], assigneeId: userIds[2], requiresApproval: false },
      // Engineering team items
      { teamId: teamIds[1], type: "incident", title: "API response time degradation", description: "P95 latency increased from 200ms to 800ms.", priority: "P1", status: "IN_PROGRESS", createdBy: userIds[4], assigneeId: userIds[5], requiresApproval: false },
      { teamId: teamIds[1], type: "task", title: "Upgrade Node.js to v22 LTS", description: "Scheduled maintenance upgrade.", priority: "P3", status: "OPEN", createdBy: userIds[6], requiresApproval: false },
      { teamId: teamIds[1], type: "task", title: "Database connection pool tuning", description: "Optimize pool settings for production load.", priority: "P2", status: "RESOLVED", createdBy: userIds[5], assigneeId: userIds[5], requiresApproval: false },
      // Compliance team items
      { teamId: teamIds[2], type: "compliance", title: "Quarterly SOC2 evidence collection", description: "Gather evidence for Q3 SOC2 audit.", priority: "P1", status: "IN_PROGRESS", createdBy: userIds[7], assigneeId: userIds[8], requiresApproval: true },
      { teamId: teamIds[2], type: "compliance", title: "GDPR data deletion request #1204", description: "Customer requested complete data deletion.", priority: "P2", status: "OPEN", createdBy: userIds[9], requiresApproval: true },
      { teamId: teamIds[2], type: "task", title: "Update privacy policy", description: "Legal team provided revised privacy policy text.", priority: "P3", status: "CLOSED", createdBy: userIds[8], assigneeId: userIds[8], requiresApproval: false },
    ];

    const itemIds: string[] = [];
    for (const item of sampleItems) {
      const dueAt = Math.random() > 0.5
        ? new Date(Date.now() + Math.random() * 14 * 24 * 60 * 60 * 1000 - 3 * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const result = await client.query(
        `INSERT INTO work_items (team_id, type, title, description, priority, status, created_by, assignee_id, requires_approval, due_at, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          item.teamId,
          item.type,
          item.title,
          item.description,
          item.priority,
          item.status,
          item.createdBy,
          item.assigneeId ?? null,
          item.requiresApproval,
          dueAt,
          item.status === "OPEN" ? 1 : Math.floor(Math.random() * 3) + 1,
        ]
      );
      itemIds.push(result.rows[0].id);

      // Create activity event for creation
      await client.query(
        `INSERT INTO activity_events (item_id, actor_id, event_type, after_data)
         VALUES ($1, $2, 'ITEM_CREATED', $3)`,
        [
          result.rows[0].id,
          item.createdBy,
          JSON.stringify({ type: item.type, title: item.title, priority: item.priority, status: "OPEN" }),
        ]
      );
    }

    console.log(`  Created ${itemIds.length} work items`);

    // Create pending approvals for PENDING_APPROVAL items
    const pendingApprovalResult = await client.query(
      `INSERT INTO work_items (team_id, type, title, description, priority, status, created_by, assignee_id, requires_approval, version)
       VALUES ($1, $2, $3, $4, $5, 'PENDING_APPROVAL', $6, $7, TRUE, 3)
       RETURNING id`,
      [
        teamIds[0],
        "payment",
        "High-value refund processing #9001",
        "Refund over $10,000 requires lead approval.",
        "P1",
        userIds[1],  // created by Bob
        userIds[1],  // assigned to Bob
      ]
    );

    // Create the approval record
    await client.query(
      `INSERT INTO approvals (item_id, requested_by)
       VALUES ($1, $2)`,
      [pendingApprovalResult.rows[0].id, userIds[1]]
    );

    await client.query(
      `INSERT INTO activity_events (item_id, actor_id, event_type, after_data)
       VALUES ($1, $2, 'ITEM_CREATED', $3)`,
      [
        pendingApprovalResult.rows[0].id,
        userIds[1],
        JSON.stringify({ type: "payment", title: "High-value refund processing #9001", priority: "P1", status: "OPEN" }),
      ]
    );

    console.log(`  Created pending approval item`);

    // Add some comments
    const comments = [
      { itemId: itemIds[0], userId: userIds[0], body: "I'll escalate this to the payment processor." },
      { itemId: itemIds[0], userId: userIds[1], body: "Customer has been notified. Transaction ID: TXN-4521-A." },
      { itemId: itemIds[2], userId: userIds[2], body: "Investigating timeout patterns. Seems correlated with peak hours." },
      { itemId: itemIds[3], userId: userIds[5], body: "Found the issue - unoptimized query on the orders table." },
    ];

    for (const comment of comments) {
      await client.query(
        `INSERT INTO comments (item_id, user_id, body) VALUES ($1, $2, $3)`,
        [comment.itemId, comment.userId, comment.body]
      );
    }

    console.log(`  Created ${comments.length} comments`);

    // Generate ~20,000 bulk items
    console.log("  Generating bulk work items...");
    const BULK_COUNT = 20_000;
    const BATCH_SIZE = 500;

    // Build team member lookup for valid assignee-team combos
    const teamMemberMap: Record<string, string[]> = {};
    for (const m of memberships) {
      if (m.role !== "viewer") {
        if (!teamMemberMap[m.teamId]) teamMemberMap[m.teamId] = [];
        teamMemberMap[m.teamId].push(m.userId);
      }
    }

    const titlePrefixes = [
      "Investigate", "Review", "Fix", "Process", "Audit", "Update",
      "Resolve", "Handle", "Escalate", "Verify", "Analyze", "Monitor",
    ];
    const titleSubjects = [
      "customer complaint", "payment discrepancy", "system alert",
      "compliance report", "access request", "security incident",
      "service outage", "data migration", "policy violation",
      "integration error", "account issue", "billing dispute",
      "performance degradation", "configuration change", "deployment failure",
    ];

    let bulkInserted = 0;
    for (let batch = 0; batch < Math.ceil(BULK_COUNT / BATCH_SIZE); batch++) {
      const batchCount = Math.min(BATCH_SIZE, BULK_COUNT - bulkInserted);
      const values: string[] = [];
      const params: unknown[] = [];
      let pi = 1;

      for (let i = 0; i < batchCount; i++) {
        const teamIdx = Math.floor(Math.random() * teamIds.length);
        const teamId = teamIds[teamIdx];
        const teamMembers = teamMemberMap[teamId];
        const type = itemTypes[Math.floor(Math.random() * itemTypes.length)];
        const priority = priorities[Math.floor(Math.random() * priorities.length)];
        const prefix = titlePrefixes[Math.floor(Math.random() * titlePrefixes.length)];
        const subject = titleSubjects[Math.floor(Math.random() * titleSubjects.length)];
        const title = `${prefix} ${subject} #${bulkInserted + i + 1000}`;
        const description = `Auto-generated item for ${subject}. Reference: BULK-${bulkInserted + i}.`;

        const statusRand = Math.random();
        let status: string;
        if (statusRand < 0.2) status = "OPEN";
        else if (statusRand < 0.45) status = "IN_PROGRESS";
        else if (statusRand < 0.55) status = "PENDING_APPROVAL";
        else if (statusRand < 0.65) status = "APPROVED";
        else if (statusRand < 0.7) status = "REJECTED";
        else if (statusRand < 0.85) status = "RESOLVED";
        else status = "CLOSED";

        const requiresApproval = type === "payment" || type === "compliance" ? Math.random() > 0.3 : Math.random() > 0.8;

        let assigneeId: string | null = null;
        if (status !== "OPEN" && Math.random() > 0.2) {
          assigneeId = teamMembers[Math.floor(Math.random() * teamMembers.length)];
        }

        const createdBy = teamMembers[Math.floor(Math.random() * teamMembers.length)];

        let dueAt: string | null = null;
        if (Math.random() > 0.4) {
          const daysOffset = Math.floor(Math.random() * 30) - 10;
          dueAt = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000).toISOString();
        }

        const version = status === "OPEN" ? 1 : Math.floor(Math.random() * 5) + 1;
        const createdDaysAgo = Math.floor(Math.random() * 90);
        const createdAt = new Date(Date.now() - createdDaysAgo * 24 * 60 * 60 * 1000).toISOString();

        values.push(
          `($${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3}, $${pi + 4}, $${pi + 5}, $${pi + 6}, $${pi + 7}, $${pi + 8}, $${pi + 9}, $${pi + 10}, $${pi + 11})`
        );
        params.push(
          teamId, type, title, description, priority, status,
          createdBy, assigneeId, requiresApproval, dueAt, version,
          createdAt
        );
        pi += 12;
      }

      await client.query(
        `INSERT INTO work_items (team_id, type, title, description, priority, status, created_by, assignee_id, requires_approval, due_at, version, created_at)
         VALUES ${values.join(", ")}`,
        params
      );

      bulkInserted += batchCount;
      if (bulkInserted % 5000 === 0) {
        console.log(`    Inserted ${bulkInserted} / ${BULK_COUNT} items`);
      }
    }

    console.log(`  Created ${bulkInserted} bulk work items`);

    // Create approval records for PENDING_APPROVAL items
    const pendingItems = await client.query(
      `SELECT id, created_by FROM work_items WHERE status = 'PENDING_APPROVAL' AND id NOT IN (SELECT item_id FROM approvals)`
    );

    for (const item of pendingItems.rows) {
      await client.query(
        `INSERT INTO approvals (item_id, requested_by) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [item.id, item.created_by]
      );
    }

    console.log(`  Created approvals for pending items`);

    await client.query("COMMIT");
    console.log("Seeding complete!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
