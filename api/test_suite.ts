import { pool } from "./src/db/pool";

const BASE_URL = "http://localhost:4000";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function request(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, options);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // not json
  }
  return { status: res.status, headers: res.headers, body: json };
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("       OPSDESK BACKEND AUTOMATED TEST SUITE            ");
  console.log("=======================================================\n");

  // SECTION 1: Health & Authentication
  console.log("--- 1. Health and Authentication ---");

  // 1. Health
  const healthRes = await request("/api/health");
  assert(healthRes.status === 200 && healthRes.body.status === "ok" && healthRes.body.database === "connected",
    "GET /api/health returns 200 with status: ok, database: connected");

  // 2. Login valid
  const loginAlice = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "alice@opsdesk.dev", password: "password123" }),
  });
  assert(loginAlice.status === 200 && !!loginAlice.body.token && loginAlice.body.user.email === "alice@opsdesk.dev",
    "POST /api/auth/login returns 200 and token for valid credentials");
  const aliceToken = loginAlice.body.token;

  // Login Bob (Payments member)
  const loginBob = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "bob@opsdesk.dev", password: "password123" }),
  });
  const bobToken = loginBob.body.token;

  // Login Eve (Engineering lead)
  const loginEve = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "eve@opsdesk.dev", password: "password123" }),
  });
  const eveToken = loginEve.body.token;

  // Login Diana (Payments viewer)
  const loginDiana = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "diana@opsdesk.dev", password: "password123" }),
  });
  const dianaToken = loginDiana.body.token;

  // 3. Login wrong password
  const loginWrongPw = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "alice@opsdesk.dev", password: "wrongpassword" }),
  });
  assert(loginWrongPw.status === 401 && loginWrongPw.body.message === "Invalid email or password",
    "POST /api/auth/login returns 401 for wrong password");

  // 4. Login unknown email
  const loginUnknown = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nonexistent@opsdesk.dev", password: "password123" }),
  });
  assert(loginUnknown.status === 401 && loginUnknown.body.message === "Invalid email or password",
    "POST /api/auth/login returns identical 401 error message for unknown email (anti-enumeration)");

  // 5. GET /api/auth/me valid
  const meRes = await request("/api/auth/me", {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert(meRes.status === 200 && meRes.body.user.name === "Alice Johnson" && Array.isArray(meRes.body.memberships),
    "GET /api/auth/me returns 200 with user profile and team memberships");

  // 6. GET /api/auth/me without token
  const meNoToken = await request("/api/auth/me");
  assert(meNoToken.status === 401, "GET /api/auth/me returns 401 without token");

  // 7. GET /api/auth/me with invalid token
  const meBadToken = await request("/api/auth/me", {
    headers: { Authorization: "Bearer invalid.jwt.token" },
  });
  assert(meBadToken.status === 401, "GET /api/auth/me returns 401 with invalid token");


  // SECTION 2: Teams and Work Items
  console.log("\n--- 2. Teams and Work Items ---");

  // 8. GET /api/teams
  const teamsRes = await request("/api/teams", {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert(teamsRes.status === 200 && teamsRes.body.teams.length > 0, "GET /api/teams lists accessible teams");
  const paymentsTeam = teamsRes.body.teams.find((t: any) => t.slug === "payments");
  const paymentsTeamId = paymentsTeam.id;

  // 9. GET /api/teams/:id
  const teamDetail = await request(`/api/teams/${paymentsTeamId}`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert(teamDetail.status === 200 && teamDetail.body.team.slug === "payments" && teamDetail.body.role === "lead",
    "GET /api/teams/:id returns team details and user role");

  // 10. GET /api/teams/:id/members
  const membersRes = await request(`/api/teams/${paymentsTeamId}/members`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert(membersRes.status === 200 && membersRes.body.members.length >= 4,
    "GET /api/teams/:id/members returns member roster with roles");

  // 11. GET /api/items (search, filter, pagination)
  const itemsList = await request(`/api/items?teamId=${paymentsTeamId}&limit=10`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert(itemsList.status === 200 && Array.isArray(itemsList.body.items) && typeof itemsList.body.nextCursor === "string",
    "GET /api/items returns { items, nextCursor } with keyset pagination");

  // 12. POST /api/items (create item with idempotency key)
  const createIdempKey = `create-item-${Date.now()}`;
  const createItemRes = await request("/api/items", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": createIdempKey,
    },
    body: JSON.stringify({
      teamId: paymentsTeamId,
      type: "payment",
      title: "Test payment dispute #7788",
      description: "Customer chargeback request for transaction #7788",
      priority: "P1",
      requiresApproval: true,
    }),
  });
  assert(createItemRes.status === 201 && !!createItemRes.body.item?.id,
    "POST /api/items creates new item with Idempotency-Key");
  const createdItem = createItemRes.body.item;
  const createdItemId = createdItem.id;

  // 13. GET /api/items/:id (with permissions)
  const getItemRes = await request(`/api/items/${createdItemId}`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert(getItemRes.status === 200 && getItemRes.body.item.id === createdItemId && !!getItemRes.body.permissions,
    "GET /api/items/:id returns item, team, assignee, and permissions object");

  // 14. PATCH /api/items/:id
  const patchRes = await request(`/api/items/${createdItemId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expectedVersion: 1,
      title: "Updated payment dispute #7788",
      priority: "P0",
    }),
  });
  assert(patchRes.status === 200 && patchRes.body.item.version === 2 && patchRes.body.item.priority === "P0",
    "PATCH /api/items/:id updates fields and increments version to 2");

  // 15. POST /api/items/:id/claim
  const claimRes = await request(`/api/items/${createdItemId}/claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert(claimRes.status === 200 && claimRes.body.item.assignee_id === loginBob.body.user.id,
    "POST /api/items/:id/claim claims unassigned item atomically");

  // 16. POST /api/items/:id/assign
  // Find Charlie's ID in payments team
  const charlie = membersRes.body.members.find((m: any) => m.name === "Charlie Brown");
  const assignRes = await request(`/api/items/${createdItemId}/assign`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aliceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assigneeId: charlie.id,
      expectedVersion: 3, // version was bumped by claim
    }),
  });
  assert(assignRes.status === 200 && assignRes.body.item.assignee_id === charlie.id,
    "POST /api/items/:id/assign reassigns item to another team member");

  // 17. POST /api/items/:id/unassign
  const unassignRes = await request(`/api/items/${createdItemId}/unassign`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aliceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expectedVersion: 4, // bumped by assign
    }),
  });
  assert(unassignRes.status === 200 && unassignRes.body.item.assignee_id === null,
    "POST /api/items/:id/unassign unassigns item by lead");

  // 18. POST /api/items/:id/comments & 19. GET /api/items/:id/comments
  const commentKey = `comment-${Date.now()}`;
  const commentRes = await request(`/api/items/${createdItemId}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": commentKey,
    },
    body: JSON.stringify({
      body: "Investigating the card processor logs for dispute #7788.",
    }),
  });
  assert(commentRes.status === 201 && !!commentRes.body.comment?.id,
    "POST /api/items/:id/comments adds comment with Idempotency-Key");

  const listCommentsRes = await request(`/api/items/${createdItemId}/comments`, {
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert(listCommentsRes.status === 200 && listCommentsRes.body.comments.length > 0,
    "GET /api/items/:id/comments lists item comments");

  // 20. GET /api/items/:id/activity
  const activityRes = await request(`/api/items/${createdItemId}/activity`, {
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert(activityRes.status === 200 && activityRes.body.events.length >= 4,
    "GET /api/items/:id/activity returns append-only audit trail");


  // SECTION 3: Critical Business Rules
  console.log("\n--- 3. Critical Business Rules ---");

  // TEST 1: Atomic Claiming & Repeat Idempotency
  console.log("  Testing Atomic Claiming:");
  // Re-claim by Bob (item currently has version 5 after unassign, assignee is null)
  const bobClaim1 = await request(`/api/items/${createdItemId}/claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert(bobClaim1.status === 200 && bobClaim1.body.item.assignee_id === loginBob.body.user.id,
    "First claim by Bob succeeds");

  // Repeat claim by Bob should be idempotent 200 OK
  const bobClaimRepeat = await request(`/api/items/${createdItemId}/claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert(bobClaimRepeat.status === 200 && bobClaimRepeat.body.item.assignee_id === loginBob.body.user.id,
    "Repeat claim by SAME user returns 200 OK with current item (idempotent double-click)");

  // Claim by Charlie should return 409 ALREADY_CLAIMED
  const charlieLoginRes = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "charlie@opsdesk.dev", password: "password123" }),
  });
  const charlieToken = charlieLoginRes.body.token;

  const charlieClaimConflict = await request(`/api/items/${createdItemId}/claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${charlieToken}` },
  });
  assert(charlieClaimConflict.status === 409 && charlieClaimConflict.body.error === "ALREADY_CLAIMED",
    "Claim by another member returns 409 Conflict with code ALREADY_CLAIMED");

  // TEST 2: Stale Version Detection
  console.log("  Testing Stale Version Detection:");
  const currentVersion = bobClaim1.body.item.version;
  const stalePatch = await request(`/api/items/${createdItemId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expectedVersion: currentVersion - 1, // Stale!
      title: "This update should be rejected",
    }),
  });
  assert(stalePatch.status === 409 && stalePatch.body.error === "VERSION_CONFLICT" && !!stalePatch.body.details?.current,
    "Stale update returns 409 Conflict with code VERSION_CONFLICT and current item");

  // TEST 3: Idempotency Keys & Deduplication
  console.log("  Testing Idempotency Keys:");
  const testKey = `idemp-test-${Date.now()}`;
  const payloadA = {
    teamId: paymentsTeamId,
    type: "task",
    title: "Idempotent task test",
    description: "Original description",
    priority: "P2",
  };

  const idempReq1 = await request("/api/items", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": testKey,
    },
    body: JSON.stringify(payloadA),
  });
  assert(idempReq1.status === 201, "First request with idempotency key creates resource");
  const firstCreatedId = idempReq1.body.item.id;

  // Exact duplicate request with same key
  const idempReqDuplicate = await request("/api/items", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": testKey,
    },
    body: JSON.stringify(payloadA),
  });
  assert(idempReqDuplicate.status === 201 && idempReqDuplicate.body.item.id === firstCreatedId,
    "Exact retry with SAME key returns identical saved response (no second item created)");

  // Reusing same key with different body must return 422 IDEMPOTENCY_KEY_REUSED
  const idempReqTampered = await request("/api/items", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": testKey,
    },
    body: JSON.stringify({ ...payloadA, title: "Tampered title with same key" }),
  });
  assert(idempReqTampered.status === 422 && idempReqTampered.body.error === "IDEMPOTENCY_KEY_REUSED",
    "Reusing key with different body returns 422 Unprocessable Entity (IDEMPOTENCY_KEY_REUSED)");

  // TEST 4: Team Authorization & Security
  console.log("  Testing Team Authorization:");
  // Eve is Engineering lead, NOT a Payments member. Trying to access Payments item:
  const crossTeamRead = await request(`/api/items/${createdItemId}`, {
    headers: { Authorization: `Bearer ${eveToken}` },
  });
  assert(crossTeamRead.status === 404,
    "Cross-team access returns 404 Not Found (does NOT leak resource existence via 403)");

  // Diana is Payments VIEWER. She can read, but cannot claim, edit, or transition:
  const viewerRead = await request(`/api/items/${createdItemId}`, {
    headers: { Authorization: `Bearer ${dianaToken}` },
  });
  assert(viewerRead.status === 200, "Viewer CAN read team work items");

  const viewerEdit = await request(`/api/items/${createdItemId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${dianaToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expectedVersion: currentVersion, title: "Viewer attempted edit" }),
  });
  assert(viewerEdit.status === 403, "Viewer CANNOT edit item (403 Forbidden)");

  // TEST 5: Workflow & Approval Rules
  console.log("  Testing Workflow & Approval Rules:");
  // Create an item requiring approval:
  const approvalItemRes = await request("/api/items", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `wf-${Date.now()}`,
    },
    body: JSON.stringify({
      teamId: paymentsTeamId,
      type: "payment",
      title: "Refund requiring approval",
      description: "Large customer refund",
      priority: "P1",
      requiresApproval: true,
    }),
  });
  const wfItemId = approvalItemRes.body.item.id;
  let wfVersion = approvalItemRes.body.item.version;

  // Unassigned item cannot move to IN_PROGRESS
  const unassignedToInProgress = await request(`/api/items/${wfItemId}/transition`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `wf-trans-1-${Date.now()}`,
    },
    body: JSON.stringify({ status: "IN_PROGRESS", expectedVersion: wfVersion }),
  });
  assert(unassignedToInProgress.status === 422,
    "Moving unassigned item to IN_PROGRESS is rejected (assignee required)");

  // Bob claims it
  const wfClaim = await request(`/api/items/${wfItemId}/claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  wfVersion = wfClaim.body.item.version;

  // Now move to IN_PROGRESS succeeds
  const moveToInProgress = await request(`/api/items/${wfItemId}/transition`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `wf-trans-2-${Date.now()}`,
    },
    body: JSON.stringify({ status: "IN_PROGRESS", expectedVersion: wfVersion }),
  });
  assert(moveToInProgress.status === 200 && moveToInProgress.body.item.status === "IN_PROGRESS",
    "Transition to IN_PROGRESS succeeds once assigned");
  wfVersion = moveToInProgress.body.item.version;

  // Cannot skip approval and go IN_PROGRESS -> RESOLVED directly when requires_approval = true
  const skipApproval = await request(`/api/items/${wfItemId}/transition`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `wf-trans-3-${Date.now()}`,
    },
    body: JSON.stringify({ status: "RESOLVED", expectedVersion: wfVersion }),
  });
  assert(skipApproval.status === 422,
    "Cannot skip approval to RESOLVED when requires_approval = true");

  // Move to PENDING_APPROVAL
  const moveToPendingApproval = await request(`/api/items/${wfItemId}/transition`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `wf-trans-4-${Date.now()}`,
    },
    body: JSON.stringify({ status: "PENDING_APPROVAL", expectedVersion: wfVersion }),
  });
  assert(moveToPendingApproval.status === 200 && moveToPendingApproval.body.item.status === "PENDING_APPROVAL",
    "Transition to PENDING_APPROVAL creates pending approval record");
  wfVersion = moveToPendingApproval.body.item.version;

  // Generic transition endpoint CANNOT be used to directly APPROVED (bug fix #2)
  const bypassApproval = await request(`/api/items/${wfItemId}/transition`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `wf-trans-5-${Date.now()}`,
    },
    body: JSON.stringify({ status: "APPROVED", expectedVersion: wfVersion }),
  });
  assert(bypassApproval.status === 403 && bypassApproval.body.error === "APPROVAL_REQUIRED",
    "Generic transition to APPROVED rejected with 403 APPROVAL_REQUIRED");

  // Find the approval record ID
  const pendingApprovalsRes = await request("/api/approvals/pending", {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  const myApproval = pendingApprovalsRes.body.approvals.find((a: any) => a.item_id === wfItemId);
  assert(!!myApproval, "Team lead Alice sees pending approval in GET /api/approvals/pending");

  // Bob (the requester) cannot approve his own item (SELF_APPROVAL)
  // Even if Bob were a lead, self approval is forbidden
  const selfApprove = await request(`/api/approvals/${myApproval.id}/approve`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expectedVersion: wfVersion }),
  });
  assert(selfApprove.status === 403, "Self-approval / non-lead approval rejected (403)");

  // Alice (Payments lead) approves
  const leadApprove = await request(`/api/approvals/${myApproval.id}/approve`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aliceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expectedVersion: wfVersion }),
  });
  assert(leadApprove.status === 200 && leadApprove.body.item.status === "APPROVED",
    "Lead Alice approves item, status becomes APPROVED");
  wfVersion = leadApprove.body.item.version;

  // After approval, move to RESOLVED
  const resolveRes = await request(`/api/items/${wfItemId}/transition`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `wf-trans-6-${Date.now()}`,
    },
    body: JSON.stringify({ status: "RESOLVED", expectedVersion: wfVersion }),
  });
  assert(resolveRes.status === 200 && resolveRes.body.item.status === "RESOLVED",
    "Approved item successfully transitions to RESOLVED");


  // SECTION 4: Dashboard and Notifications
  console.log("\n--- 4. Dashboard and Notifications ---");

  // 27. GET /api/dashboard
  const dashRes = await request("/api/dashboard", {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert(dashRes.status === 200 && typeof dashRes.body.myAssigned?.count === "number" && typeof dashRes.body.unassignedHighPriority?.count === "number",
    "GET /api/dashboard returns aggregations for user teams and assignments");

  // 28. Notifications (wait 2s for background worker to process outbox)
  console.log("  Waiting 2s for background outbox worker to deliver notifications...");
  await new Promise((r) => setTimeout(r, 2000));

  const notifsRes = await request("/api/notifications", {
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert(notifsRes.status === 200 && Array.isArray(notifsRes.body.notifications),
    "GET /api/notifications returns user notifications");

  if (notifsRes.body.notifications.length > 0) {
    const notifId = notifsRes.body.notifications[0].id;
    // 29. Mark one read
    const readOne = await request(`/api/notifications/${notifId}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(readOne.status === 200 && readOne.body.success === true,
      "POST /api/notifications/:id/read marks single notification read");

    // 30. Mark all read
    const readAll = await request("/api/notifications/read-all", {
      method: "POST",
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert(readAll.status === 200 && readAll.body.success === true,
      "POST /api/notifications/read-all marks all notifications read");
  }


  // SECTION 5: High-Concurrency Race Test
  console.log("\n--- 5. High-Concurrency Race Condition Test ---");
  console.log("  Creating a fresh unassigned item...");

  const raceItemRes = await request("/api/items", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aliceToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `race-${Date.now()}`,
    },
    body: JSON.stringify({
      teamId: paymentsTeamId,
      type: "incident",
      title: "Critical P0 Outage - Race Claim Test",
      description: "Ten simultaneous workers racing to claim this item.",
      priority: "P0",
    }),
  });
  const raceItemId = raceItemRes.body.item.id;

  console.log(`  Dispatching 10 parallel claim requests to item ${raceItemId}...`);
  // Alice, Bob, Charlie are payments members. We'll send 10 simultaneous claims.
  const claimRequests = [
    request(`/api/items/${raceItemId}/claim`, { method: "POST", headers: { Authorization: `Bearer ${aliceToken}` } }),
    request(`/api/items/${raceItemId}/claim`, { method: "POST", headers: { Authorization: `Bearer ${bobToken}` } }),
    request(`/api/items/${raceItemId}/claim`, { method: "POST", headers: { Authorization: `Bearer ${charlieToken}` } }),
    request(`/api/items/${raceItemId}/claim`, { method: "POST", headers: { Authorization: `Bearer ${aliceToken}` } }),
    request(`/api/items/${raceItemId}/claim`, { method: "POST", headers: { Authorization: `Bearer ${bobToken}` } }),
    request(`/api/items/${raceItemId}/claim`, { method: "POST", headers: { Authorization: `Bearer ${charlieToken}` } }),
    request(`/api/items/${raceItemId}/claim`, { method: "POST", headers: { Authorization: `Bearer ${aliceToken}` } }),
    request(`/api/items/${raceItemId}/claim`, { method: "POST", headers: { Authorization: `Bearer ${bobToken}` } }),
    request(`/api/items/${raceItemId}/claim`, { method: "POST", headers: { Authorization: `Bearer ${charlieToken}` } }),
    request(`/api/items/${raceItemId}/claim`, { method: "POST", headers: { Authorization: `Bearer ${aliceToken}` } }),
  ];

  const results = await Promise.all(claimRequests);
  const successCount = results.filter((r) => r.status === 200).length;
  const conflictCount = results.filter((r) => r.status === 409).length;

  console.log(`  Results: ${successCount} succeeded, ${conflictCount} conflicts`);
  // Exactly 1 initial claimant wins. (Subsequent calls by that same claimant return 200 due to idempotency; calls by others return 409)
  // Let's verify against the database that exactly 1 assignee was set:
  const dbCheck = await pool.query("SELECT assignee_id, version FROM work_items WHERE id = $1", [raceItemId]);
  const assignee = dbCheck.rows[0].assignee_id;
  assert(assignee !== null, "Item is assigned to exactly one winner in database");

  // Check activity events for claim
  const claimEvents = await pool.query(
    "SELECT * FROM activity_events WHERE item_id = $1 AND event_type = 'ITEM_CLAIMED'",
    [raceItemId]
  );
  assert(claimEvents.rows.length === 1,
    `Database recorded EXACTLY 1 ITEM_CLAIMED activity event (found ${claimEvents.rows.length})`);

  console.log("\n=======================================================");
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
