/**
 * OpsDesk backend smoke test — prints ✅ / ❌ for every requirement.
 *
 * Put this file at:   api/scripts/smoke.ts
 * Run (DB + API + worker running, DB seeded):   npx tsx scripts/smoke.ts
 *
 * Needs 5 seeded users:
 *   lead, member, member2, viewer  → all in the SAME team (lead has role 'lead', viewer has role 'viewer')
 *   outsider                       → NOT in that team
 *
 * Edit the CONFIG block if your seed emails / request field names differ.
 */
import { randomUUID } from "node:crypto";

// ===================== CONFIG =====================
const BASE = process.env.API_URL ?? "http://localhost:4000/api";
const PASSWORD = process.env.SEED_PASSWORD ?? "password123";
const EMAILS: Record<string, string> = {
  lead: process.env.LEAD_EMAIL ?? "lead@opsdesk.dev",
  member: process.env.MEMBER_EMAIL ?? "member@opsdesk.dev",
  member2: process.env.MEMBER2_EMAIL ?? "member2@opsdesk.dev",
  viewer: process.env.VIEWER_EMAIL ?? "viewer@opsdesk.dev",
  outsider: process.env.OUTSIDER_EMAIL ?? "outsider@opsdesk.dev",
};
const TEAM_ID_OVERRIDE = process.env.TEAM_ID; // optional: force the test team

// Request bodies — change field names here if your API uses different ones
const transitionBody = (to: string, expectedVersion: number) => ({ status: to, expectedVersion });
const assignBody = (assigneeId: string, expectedVersion: number) => ({ assigneeId, expectedVersion });
const approveBody = (expectedVersion: number) => ({ expectedVersion });
const rejectBody = (expectedVersion: number, reason?: string) => ({ expectedVersion, ...(reason ? { reason } : {}) });
const CURSOR_PARAM = "cursor";
const WORKER_WAIT_MS = 15_000;
const SLOW_MS = 500;
// ==================================================

type Res = { status: number; data: any; ms: number };

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; key?: string | null } = {}
): Promise<Res> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  // every POST mutation gets an Idempotency-Key unless key: null is passed explicitly
  if (opts.key) headers["Idempotency-Key"] = opts.key;
  else if (method !== "GET" && opts.key !== null && !path.startsWith("/auth")) headers["Idempotency-Key"] = randomUUID();

  const t = performance.now();
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const ms = Math.round(performance.now() - t);
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, data, ms };
}

// ---------- tolerant field readers (camelCase or snake_case) ----------
const ok = (s: number) => s >= 200 && s < 300;
const is4xx = (s: number) => s >= 400 && s < 500;
const f = (o: any, ...keys: string[]) => {
  for (const k of keys) {
    const v = k.split(".").reduce((a: any, p) => a?.[p], o);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};
const itemOf = (d: any) => d?.item ?? d?.data ?? d;
const listOf = (d: any): any[] => {
  if (Array.isArray(d)) return d;
  for (const k of ["items", "data", "results", "approvals", "notifications", "events", "activity", "comments", "members", "memberships", "teams"])
    if (Array.isArray(d?.[k])) return d[k];
  return [];
};
const nextCursorOf = (d: any) => f(d, "nextCursor", "next_cursor", "pageInfo.nextCursor") ?? null;
const codeOf = (d: any) => f(d, "details.code", "code", "error");
const assigneeOf = (it: any) => f(it, "assignee_id", "assigneeId", "assignee.id") ?? null;
const itemIdOf = (x: any) => f(x, "item_id", "itemId", "item.id");
const evType = (e: any) => String(f(e, "event_type", "eventType", "type") ?? "").toUpperCase();
const ts = (x: any, which: "created" | "updated") =>
  new Date(f(x, `${which}_at`, `${which}At`) ?? 0).getTime();
const short = (x: any) => {
  const s = typeof x === "string" ? x : JSON.stringify(x);
  return s && s.length > 220 ? s.slice(0, 220) + "…" : s;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- result tracking ----------
const results: { section: string; name: string; pass: boolean }[] = [];
let current = "";
function check(name: string, pass: boolean, info?: unknown) {
  results.push({ section: current, name, pass });
  const extra = !pass && info !== undefined ? `\n      ↳ ${short(info)}` : "";
  console.log(`${pass ? "✅" : "❌"} ${name}${extra}`);
}
async function run(name: string, fn: () => Promise<void>) {
  current = name;
  console.log(`\n━━ ${name} ━━`);
  try {
    await fn();
  } catch (e: any) {
    check("section crashed (later checks in this section skipped)", false, e?.message ?? e);
  }
}

// ---------- shared state ----------
const T: Record<string, string> = {};
const U: Record<string, string> = {};
let TEAM = "";
const TAG = "smk" + Date.now().toString(36);

// ---------- domain helpers ----------
async function createItem(token: string, extra: Record<string, unknown> = {}) {
  const r = await api("POST", "/items", {
    token,
    body: {
      teamId: TEAM,
      type: "task",
      title: `${TAG} item ${randomUUID().slice(0, 6)}`,
      description: "smoke test item",
      priority: "P2",
      requiresApproval: false,
      dueAt: null,
      ...extra,
    },
  });
  if (!ok(r.status)) throw new Error(`create item failed: ${r.status} ${short(r.data)}`);
  return itemOf(r.data);
}
async function getItem(id: string, token = T.lead) {
  return itemOf((await api("GET", `/items/${id}`, { token })).data);
}
async function transition(id: string, to: string, token: string, version?: number) {
  const v = version ?? (await getItem(id, token)).version;
  return api("POST", `/items/${id}/transition`, { token, body: transitionBody(to, v) });
}
async function moveTo(id: string, path: string[], token: string) {
  for (const s of path) {
    const cur = await getItem(id, token);
    if (cur.status === s) continue;
    const r = await transition(id, s, token, cur.version);
    if (!ok(r.status)) throw new Error(`transition to ${s} failed: ${r.status} ${short(r.data)}`);
  }
}
const claim = (id: string, token: string) => api("POST", `/items/${id}/claim`, { token, body: {} });
async function activity(id: string, token = T.lead) {
  return listOf((await api("GET", `/items/${id}/activity?limit=100`, { token })).data);
}
async function pendingApprovalsFor(itemId: string) {
  const r = await api("GET", "/approvals/pending", { token: T.lead });
  return listOf(r.data).filter((a) => itemIdOf(a) === itemId);
}
const approvalIdOf = (a: any) => f(a, "approval.id", "approvalId", "approval_id", "id");
async function waitFor<X>(fn: () => Promise<X | undefined>, ms = WORKER_WAIT_MS) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  return undefined;
}
async function notificationsOf(token: string) {
  return listOf((await api("GET", "/notifications?limit=100", { token })).data);
}

// =====================================================================
async function main() {
  console.log(`OpsDesk smoke test → ${BASE}   (run tag: ${TAG})`);

  await run("0. Basics", async () => {
    const h = await api("GET", "/health");
    check("GET /health → 200", h.status === 200, h);
    const nf = await api("GET", "/definitely-not-a-route");
    check("unknown route → 404 JSON", nf.status === 404 && typeof nf.data === "object", nf);
  });

  await run("1. Authentication", async () => {
    for (const [role, email] of Object.entries(EMAILS)) {
      const r = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
      const token = f(r.data, "token", "accessToken", "access_token");
      check(`login works for ${role} (${email})`, ok(r.status) && !!token, r);
      if (token) T[role] = token;
      if (role === "lead") check("login response has no password hash", !/password/i.test(JSON.stringify(r.data)), r.data);
    }
    if (!T.lead || !T.member || !T.member2) throw new Error("need lead + member + member2 logins — fix EMAILS / PASSWORD in CONFIG");

    for (const role of Object.keys(T)) {
      const me = await api("GET", "/auth/me", { token: T[role] });
      U[role] = f(me.data, "user.id", "id", "userId");
    }

    const upper = await api("POST", "/auth/login", { body: { email: EMAILS.member.toUpperCase(), password: PASSWORD } });
    check("email is case-insensitive", ok(upper.status), upper);
    const bad = await api("POST", "/auth/login", { body: { email: EMAILS.member, password: "wrong-password" } });
    check("wrong password → 401", bad.status === 401, bad);
    const unknown = await api("POST", "/auth/login", { body: { email: `nobody-${TAG}@x.dev`, password: "whatever123" } });
    check(
      "unknown email → 401 with same message (no user enumeration)",
      unknown.status === 401 && JSON.stringify(unknown.data) === JSON.stringify(bad.data),
      { unknown: unknown.data, wrongPassword: bad.data }
    );
    const invalid = await api("POST", "/auth/login", { body: { email: "not-an-email" } });
    check("invalid login body → 400", invalid.status === 400, invalid);
    check("no token → 401", (await api("GET", "/items")).status === 401);
    check("garbage token → 401", (await api("GET", "/items", { token: "abc.def.ghi" })).status === 401);
    const me = await api("GET", "/auth/me", { token: T.member });
    check("GET /auth/me → 200 with user id", ok(me.status) && !!U.member, me);
    check("/auth/me has no password hash", !/password/i.test(JSON.stringify(me.data)), me.data);
  });

  await run("2. Teams & membership", async () => {
    if (TEAM_ID_OVERRIDE) TEAM = TEAM_ID_OVERRIDE;
    else {
      const me = await api("GET", "/auth/me", { token: T.lead });
      const ms = listOf(me.data?.memberships ?? me.data?.teams ?? me.data?.user?.memberships ?? me.data);
      const m = ms.find((x) => f(x, "role") === "lead");
      TEAM = f(m, "teamId", "team_id", "team.id", "id");
    }
    check("found a team where lead has role 'lead'", !!TEAM, "set TEAM_ID env var");
    if (!TEAM) throw new Error("no team");

    const teams = await api("GET", "/teams", { token: T.member });
    check("GET /teams → only my teams (includes test team)", ok(teams.status) && JSON.stringify(teams.data).includes(TEAM), teams);
    const mem = await api("GET", `/teams/${TEAM}/members`, { token: T.viewer ?? T.member });
    check("viewer can list team members", ok(mem.status), mem);
    const s = JSON.stringify(mem.data).toLowerCase();
    check("member, member2, viewer are in the test team", [EMAILS.member, EMAILS.member2, EMAILS.viewer].every((e) => s.includes(e.toLowerCase())), "fix seed: all must be in the lead's team");
    check("outsider is NOT in the test team", !s.includes(EMAILS.outsider.toLowerCase()), "fix seed: outsider must be in another team");
    if (T.outsider) {
      const o = await api("GET", `/teams/${TEAM}/members`, { token: T.outsider });
      check("outsider cannot list this team's members (403/404)", o.status === 403 || o.status === 404, o);
    }
  });

  await run("3. Authorization (enforced by API, not UI)", async () => {
    const a = await createItem(T.member);
    check("member can create item", !!a?.id, a);

    if (T.viewer) {
      check("viewer can read team item", ok((await api("GET", `/items/${a.id}`, { token: T.viewer })).status));
      const vc = await api("POST", "/items", { token: T.viewer, body: { teamId: TEAM, type: "task", title: "viewer try", priority: "P2" } });
      check("viewer cannot create item → 403", vc.status === 403, vc);
      const vcm = await api("POST", `/items/${a.id}/comments`, { token: T.viewer, body: { body: "hi" } });
      check("viewer cannot comment → 403", vcm.status === 403, vcm);
      const vcl = await claim(a.id, T.viewer);
      check("viewer cannot claim → 403", vcl.status === 403, vcl);
      const vt = await transition(a.id, "IN_PROGRESS", T.viewer, a.version);
      check("viewer cannot transition → 403", vt.status === 403, vt);
      const vp = await api("PATCH", `/items/${a.id}`, { token: T.viewer, body: { expectedVersion: a.version, title: "hacked" } });
      check("viewer cannot edit → 403", vp.status === 403, vp);
    }

    if (T.outsider) {
      const og = await api("GET", `/items/${a.id}`, { token: T.outsider });
      check("outsider GET other team's item → 404 (not 403, no existence leak)", og.status === 404, og);
      const op = await api("PATCH", `/items/${a.id}`, { token: T.outsider, body: { expectedVersion: a.version, title: "hacked" } });
      check("outsider cannot edit other team's item", is4xx(op.status), op);
      const ocl = await claim(a.id, T.outsider);
      check("outsider cannot claim other team's item", is4xx(ocl.status), ocl);
      const oa = await api("GET", `/items/${a.id}/activity`, { token: T.outsider });
      check("outsider cannot read activity", is4xx(oa.status), oa);
      const oc = await api("GET", `/items/${a.id}/comments`, { token: T.outsider });
      check("outsider cannot read comments", is4xx(oc.status), oc);
      const ol = await api("GET", `/items?search=${TAG}&limit=100`, { token: T.outsider });
      check("outsider list/search never returns other team's items", !JSON.stringify(ol.data).includes(a.id), ol);
      const ocr = await api("POST", "/items", { token: T.outsider, body: { teamId: TEAM, type: "task", title: "outsider try", priority: "P2" } });
      check("outsider cannot create item in another team (403/404)", ocr.status === 403 || ocr.status === 404, ocr);
      const ot = await api("GET", `/items?teamId=${TEAM}`, { token: T.outsider });
      check("outsider filtering by foreign teamId gets nothing", is4xx(ot.status) || listOf(ot.data).length === 0, ot);
    }

    const after = await getItem(a.id);
    check("item untouched after all unauthorized attempts", after.version === a.version && after.title === a.title, after);

    if (U.outsider) {
      const as = await api("POST", `/items/${a.id}/assign`, { token: T.lead, body: assignBody(U.outsider, after.version) });
      check("cannot assign item to a non-team-member", is4xx(as.status), as);
    }
    if (U.member2) {
      const as2 = await api("POST", `/items/${a.id}/assign`, { token: T.lead, body: assignBody(U.member2, after.version) });
      check("lead can assign to a team member", ok(as2.status), as2);
    }
  });

  await run("4. Idempotency (retries don't duplicate)", async () => {
    const word = `${TAG}idem${randomUUID().slice(0, 5)}`;
    const body = { teamId: TEAM, type: "task", title: `${word} title`, description: "", priority: "P3", requiresApproval: false, dueAt: null };
    const key = randomUUID();
    const r1 = await api("POST", "/items", { token: T.member, body, key });
    const r2 = await api("POST", "/items", { token: T.member, body, key });
    check("same key + same body → same item returned", ok(r1.status) && ok(r2.status) && itemOf(r1.data).id === itemOf(r2.data).id, { r1: r1.status, r2: r2.status });

    const key2 = randomUUID();
    const body2 = { ...body, title: `${word} parallel` };
    const par = await Promise.all(Array.from({ length: 6 }, () => api("POST", "/items", { token: T.member, body: body2, key: key2 })));
    const ids = new Set(par.filter((p) => ok(p.status)).map((p) => itemOf(p.data).id));
    check("6 parallel requests with same key → exactly 1 item", ids.size === 1 && par.every((p) => ok(p.status) || p.status === 409), par.map((p) => p.status));

    const srch = await api("GET", `/items?search=${word}&limit=50`, { token: T.member });
    check("database contains exactly 2 items for this test (no duplicates)", listOf(srch.data).length === 2, listOf(srch.data).length);

    const r3 = await api("POST", "/items", { token: T.member, body: { ...body, title: "different" }, key });
    check("same key + different body → 422", r3.status === 422, r3);
    const r4 = await api("POST", "/items", { token: T.member, body: { ...body, title: "otheruser" }, key: key, });
    check("(sanity) repeated mismatch still 422", r4.status === 422, r4);
    const r5 = await api("POST", "/items", { token: T.member2, body, key });
    check("same key from a DIFFERENT user is independent (creates new item)", ok(r5.status) && itemOf(r5.data).id !== itemOf(r1.data).id, r5);

    const nokey = await api("POST", "/items", { token: T.member, body, key: null });
    check("create without Idempotency-Key → 400", nokey.status === 400, nokey);

    const it = itemOf(r1.data);
    const ck = randomUUID();
    await api("POST", `/items/${it.id}/comments`, { token: T.member, body: { body: "retry me" }, key: ck });
    await api("POST", `/items/${it.id}/comments`, { token: T.member, body: { body: "retry me" }, key: ck });
    const cs = listOf((await api("GET", `/items/${it.id}/comments`, { token: T.member })).data);
    check("repeated comment with same key → stored once", cs.filter((c) => f(c, "body") === "retry me").length === 1, cs.length);
  });

  await run("5. Comments", async () => {
    const it = await createItem(T.member);
    const c = await api("POST", `/items/${it.id}/comments`, { token: T.member2, body: { body: "looking into it" } });
    check("member can comment", ok(c.status), c);
    const empty = await api("POST", `/items/${it.id}/comments`, { token: T.member, body: { body: "   " } });
    check("empty comment → 400", empty.status === 400, empty);
    const list = listOf((await api("GET", `/items/${it.id}/comments`, { token: T.member })).data);
    check("comments list returns the comment", list.some((x) => f(x, "body") === "looking into it"), list);
    const after = await getItem(it.id);
    check("comment does not bump item version (no false edit conflicts)", after.version === it.version, { before: it.version, after: after.version });
  });

  await run("6. Stale updates (optimistic concurrency)", async () => {
    const it = await createItem(T.member);
    const p1 = await api("PATCH", `/items/${it.id}`, { token: T.member, body: { expectedVersion: it.version, priority: "P1" } });
    check("PATCH with correct version → 200, version +1", ok(p1.status) && itemOf(p1.data).version === it.version + 1, p1);

    const p2 = await api("PATCH", `/items/${it.id}`, { token: T.member2, body: { expectedVersion: it.version, title: "stale overwrite" } });
    check("PATCH with stale version → 409", p2.status === 409, p2);
    check("409 has machine-readable code VERSION_CONFLICT", codeOf(p2.data) === "VERSION_CONFLICT", p2.data);
    check("409 includes current item/version for the UI", JSON.stringify(p2.data).includes(`"version":${it.version + 1}`), p2.data);
    const now = await getItem(it.id);
    check("stale write did not overwrite data", now.title === it.title && now.priority === "P1", now);

    const nov = await api("PATCH", `/items/${it.id}`, { token: T.member, body: { title: "no version" } });
    check("PATCH without expectedVersion → 400", nov.status === 400, nov);

    const sneaky = await api("PATCH", `/items/${it.id}`, {
      token: T.member,
      body: { expectedVersion: now.version, status: "CLOSED", team_id: randomUUID(), teamId: randomUUID(), created_by: U.member2, version: 999 },
    });
    const after = await getItem(it.id);
    check(
      "PATCH cannot change status/team/creator/version directly",
      after.status === now.status && (f(after, "team_id", "teamId") === TEAM) && after.version <= now.version + 1,
      { status: sneaky.status, after }
    );

    const par = await Promise.all([
      api("PATCH", `/items/${it.id}`, { token: T.member, body: { expectedVersion: after.version, title: "race A" } }),
      api("PATCH", `/items/${it.id}`, { token: T.member2, body: { expectedVersion: after.version, title: "race B" } }),
    ]);
    check("2 simultaneous edits on same version → exactly one wins, other 409", par.filter((p) => ok(p.status)).length === 1 && par.some((p) => p.status === 409), par.map((p) => p.status));
  });

  await run("7. Claim race (two people grabbing the same work)", async () => {
    const it = await createItem(T.member);
    const calls = Array.from({ length: 10 }, (_, i) => claim(it.id, i % 2 === 0 ? T.member : T.member2));
    const res = await Promise.all(calls);
    const winners = new Set<string>();
    res.forEach((r, i) => {
      if (ok(r.status)) winners.add(i % 2 === 0 ? "member" : "member2");
    });
    check("10 parallel claims by 2 users → only ONE user wins", winners.size === 1, res.map((r) => r.status));
    const loser = winners.has("member") ? 1 : 0;
    check("all claims by the other user → 409", res.filter((_, i) => i % 2 === loser).every((r) => r.status === 409), res.map((r) => r.status));
    const lostOne = res.find((_, i) => i % 2 === loser);
    check("409 code is ALREADY_CLAIMED", codeOf(lostOne?.data) === "ALREADY_CLAIMED", lostOne?.data);
    const final = await getItem(it.id);
    const winnerId = winners.has("member") ? U.member : U.member2;
    check("final assignee = the winner", assigneeOf(final) === winnerId, final);
    const claims = (await activity(it.id)).filter((e) => evType(e).includes("CLAIM"));
    check("exactly ONE claim event in history", claims.length === 1, claims.length);
    const again = await claim(it.id, winners.has("member") ? T.member : T.member2);
    check("winner re-claiming (double click) → 200, not error", ok(again.status), again);
  });

  await run("8. Workflow rules", async () => {
    const w = await createItem(T.member);
    const evBefore = (await activity(w.id)).length;
    const skip = await transition(w.id, "RESOLVED", T.member, w.version);
    check("OPEN → RESOLVED rejected (4xx)", is4xx(skip.status), skip);
    check("invalid transition has code INVALID_TRANSITION", codeOf(skip.data) === "INVALID_TRANSITION", skip.data);
    const w1 = await getItem(w.id);
    check("rejected transition changed nothing (status, version)", w1.status === "OPEN" && w1.version === w.version, w1);
    check("rejected transition wrote no history", (await activity(w.id)).length === evBefore);

    await claim(w.id, T.member);
    await moveTo(w.id, ["IN_PROGRESS"], T.member);
    const w2 = await getItem(w.id);
    check("claim + OPEN → IN_PROGRESS works", w2.status === "IN_PROGRESS", w2);
    const stale = await transition(w.id, "RESOLVED", T.member, w2.version - 1);
    check("transition with stale version → 409", stale.status === 409, stale);
    const res = await transition(w.id, "RESOLVED", T.member, w2.version);
    check("IN_PROGRESS → RESOLVED allowed when no approval needed", ok(res.status), res);
    const cl = await transition(w.id, "CLOSED", T.member);
    check("RESOLVED → CLOSED allowed", ok(cl.status), cl);
    const reopen = await transition(w.id, "OPEN", T.member);
    check("CLOSED is final (CLOSED → OPEN rejected)", is4xx(reopen.status), reopen);
    const garbage = await transition(w.id, "BANANA", T.member);
    check("unknown status → 400", garbage.status === 400, garbage);
    const clClaim = await claim(w.id, T.member2);
    check("cannot claim a CLOSED item", is4xx(clClaim.status), clClaim);
  });

  let rejectedItemId = "";
  await run("9. Approvals", async () => {
    const p = await createItem(T.member, { requiresApproval: true, type: "payment", priority: "P1" });
    await claim(p.id, T.member);
    await moveTo(p.id, ["IN_PROGRESS"], T.member);

    const skip = await transition(p.id, "RESOLVED", T.member);
    check("approval-required item: IN_PROGRESS → RESOLVED blocked", is4xx(skip.status), skip);
    const fake = await transition(p.id, "APPROVED", T.lead);
    check("even a lead cannot set APPROVED via /transition (must use approvals API)", is4xx(fake.status), fake);

    const pend = await transition(p.id, "PENDING_APPROVAL", T.member);
    check("IN_PROGRESS → PENDING_APPROVAL works", ok(pend.status), pend);
    const approvals = await pendingApprovalsFor(p.id);
    check("pending approval record created", approvals.length === 1, approvals);
    const aid = approvalIdOf(approvals[0]);
    if (!aid) throw new Error("no approval id — cannot continue");
    const pv = (await getItem(p.id)).version;

    const ma = await api("POST", `/approvals/${aid}/approve`, { token: T.member, body: approveBody(pv) });
    check("member cannot approve → 403", ma.status === 403, ma);
    if (T.viewer) {
      const va = await api("POST", `/approvals/${aid}/approve`, { token: T.viewer, body: approveBody(pv) });
      check("viewer cannot approve → 403", va.status === 403, va);
    }
    if (T.outsider) {
      const oa = await api("POST", `/approvals/${aid}/approve`, { token: T.outsider, body: approveBody(pv) });
      check("outsider cannot approve (403/404)", oa.status === 403 || oa.status === 404, oa);
      const op = await api("GET", "/approvals/pending", { token: T.outsider });
      check("outsider's pending list doesn't show other team's approvals", !JSON.stringify(op.data).includes(p.id), op);
    }
    const staleA = await api("POST", `/approvals/${aid}/approve`, { token: T.lead, body: approveBody(pv - 1) });
    check("approve with stale item version → 409", staleA.status === 409, staleA);

    const both = await Promise.all([
      api("POST", `/approvals/${aid}/approve`, { token: T.lead, body: approveBody(pv) }),
      api("POST", `/approvals/${aid}/approve`, { token: T.lead, body: approveBody(pv) }),
    ]);
    check("2 simultaneous approve clicks → exactly one succeeds", both.filter((b) => ok(b.status)).length === 1, both.map((b) => b.status));
    const pa = await getItem(p.id);
    check("item is APPROVED", pa.status === "APPROVED", pa);
    check("approval no longer pending", (await pendingApprovalsFor(p.id)).length === 0);
    const done = await transition(p.id, "RESOLVED", T.member);
    check("APPROVED → RESOLVED works", ok(done.status), done);

    // self-approval
    const s = await createItem(T.lead, { requiresApproval: true });
    await claim(s.id, T.lead);
    await moveTo(s.id, ["IN_PROGRESS", "PENDING_APPROVAL"], T.lead);
    const sa = (await pendingApprovalsFor(s.id))[0];
    const self = await api("POST", `/approvals/${approvalIdOf(sa)}/approve`, { token: T.lead, body: approveBody((await getItem(s.id)).version) });
    check("lead cannot approve their own request → 403", self.status === 403, self);

    // rejection
    const r = await createItem(T.member, { requiresApproval: true });
    rejectedItemId = r.id;
    await claim(r.id, T.member);
    await moveTo(r.id, ["IN_PROGRESS", "PENDING_APPROVAL"], T.member);
    const ra = approvalIdOf((await pendingApprovalsFor(r.id))[0]);
    const rv = (await getItem(r.id)).version;
    const noReason = await api("POST", `/approvals/${ra}/reject`, { token: T.lead, body: rejectBody(rv) });
    check("reject without reason → 400", noReason.status === 400, noReason);
    const rej = await api("POST", `/approvals/${ra}/reject`, { token: T.lead, body: rejectBody(rv, "missing invoice") });
    check("reject with reason works", ok(rej.status), rej);
    check("item is REJECTED", (await getItem(r.id)).status === "REJECTED");
    const again = await api("POST", `/approvals/${ra}/approve`, { token: T.lead, body: approveBody((await getItem(r.id)).version) });
    check("cannot approve an already-rejected approval", is4xx(again.status), again);
    await moveTo(r.id, ["IN_PROGRESS", "PENDING_APPROVAL"], T.member);
    check("REJECTED → IN_PROGRESS → PENDING_APPROVAL again → exactly 1 pending approval", (await pendingApprovalsFor(r.id)).length === 1);
  });

  await run("10. Audit history", async () => {
    const it = await createItem(T.member, { requiresApproval: true });
    await api("PATCH", `/items/${it.id}`, { token: T.member, body: { expectedVersion: it.version, priority: "P0" } });
    await claim(it.id, T.member2);
    await moveTo(it.id, ["IN_PROGRESS", "PENDING_APPROVAL"], T.member2);
    const aid = approvalIdOf((await pendingApprovalsFor(it.id))[0]);
    await api("POST", `/approvals/${aid}/approve`, { token: T.lead, body: approveBody((await getItem(it.id)).version) });

    const ev = await activity(it.id);
    const types = ev.map(evType);
    check("history has creation event", types.some((t) => t.includes("CREAT")), types);
    check("history has priority change", types.some((t) => t.includes("PRIORITY") || t.includes("UPDAT")), types);
    check("history has claim/assign", types.some((t) => t.includes("CLAIM") || t.includes("ASSIGN")), types);
    check("history has status transitions", types.filter((t) => t.includes("STATUS") || t.includes("TRANSITION")).length >= 2, types);
    check("history has approval decision", types.some((t) => t.includes("APPROV")), types);
    check("events are newest first", ev.every((e, i) => i === 0 || ts(ev[i - 1], "created") >= ts(e, "created")));
    const pr = ev.find((e) => JSON.stringify(e).includes("P0"));
    check("priority event stores before (P2) and after (P0)", !!pr && JSON.stringify(pr).includes("P2"), pr);
    check("events record who did it (actor)", ev.every((e) => !!f(e, "actor_id", "actorId", "actor.id")), ev[0]);
    check("no secrets in history", !/password|bearer|jwt/i.test(JSON.stringify(ev)));
    const pg = await api("GET", `/items/${it.id}/activity?limit=2`, { token: T.member });
    check("activity is paginated (limit=2 → 2 events + nextCursor)", listOf(pg.data).length === 2 && !!nextCursorOf(pg.data), pg.data);
    const del = await api("DELETE", `/items/${it.id}/activity`, { token: T.lead });
    check("no route can delete history", del.status === 404 || del.status === 405, del);
  });

  await run("11. List, filter, search, pagination", async () => {
    const all = await api("GET", `/items?search=${TAG}&limit=100`, { token: T.member });
    const items = listOf(all.data);
    check("search by word in title finds this run's items", items.length >= 10, items.length);
    check("all results actually match", items.every((i) => JSON.stringify(i).includes(TAG)));

    const st = listOf((await api("GET", `/items?search=${TAG}&status=CLOSED`, { token: T.member })).data);
    check("status filter works", st.length > 0 && st.every((i) => i.status === "CLOSED"), st.map((i) => i.status));
    const pr = listOf((await api("GET", `/items?search=${TAG}&priority=P1`, { token: T.member })).data);
    check("priority filter works", pr.length > 0 && pr.every((i) => i.priority === "P1"), pr.map((i) => i.priority));
    const ty = listOf((await api("GET", `/items?search=${TAG}&type=payment`, { token: T.member })).data);
    check("type filter works", ty.length > 0 && ty.every((i) => i.type === "payment"), ty.map((i) => i.type));
    const as = listOf((await api("GET", `/items?search=${TAG}&assigneeId=${U.member2}`, { token: T.member })).data);
    check("assignee filter works", as.length > 0 && as.every((i) => assigneeOf(i) === U.member2), as.length);

    const p1 = await api("GET", `/items?search=${TAG}&limit=4`, { token: T.member });
    const c = nextCursorOf(p1.data);
    check("page 1 returns limit rows + nextCursor", listOf(p1.data).length === 4 && !!c, p1.data);
    const p2 = await api("GET", `/items?search=${TAG}&limit=4&${CURSOR_PARAM}=${encodeURIComponent(c ?? "")}`, { token: T.member });
    const ids1 = listOf(p1.data).map((i) => i.id);
    const ids2 = listOf(p2.data).map((i) => i.id);
    check("page 2 has no overlap with page 1", ids2.length > 0 && ids2.every((id) => !ids1.includes(id)), { ids1, ids2 });
    const both = [...listOf(p1.data), ...listOf(p2.data)];
    check("sorted by updated_at DESC across pages", both.every((x, i) => i === 0 || ts(both[i - 1], "updated") >= ts(x, "updated")));
    const badCur = await api("GET", `/items?limit=4&${CURSOR_PARAM}=not-a-real-cursor`, { token: T.member });
    check("invalid cursor → 400 (not 500)", badCur.status === 400, badCur);

    const big = await api("GET", "/items?limit=100000", { token: T.member });
    check("huge limit is rejected or clamped (≤100)", big.status === 400 || listOf(big.data).length <= 100, listOf(big.data).length);
    const badStatus = await api("GET", "/items?status=BANANA", { token: T.member });
    check("invalid filter value → 400", badStatus.status === 400, badStatus);
    const inj = await api("GET", `/items?search=${encodeURIComponent("'; DROP TABLE work_items; --")}`, { token: T.member });
    check("SQL-injection-looking search → not 500", inj.status !== 500, inj);
    const sortInj = await api("GET", `/items?sort=${encodeURIComponent("id; DROP TABLE users")}`, { token: T.member });
    check("weird sort param → not 500", sortInj.status !== 500, sortInj);
  });

  await run("12. Performance with seeded data", async () => {
    const l = await api("GET", "/items?limit=20", { token: T.member });
    check(`list first page < ${SLOW_MS}ms (got ${l.ms}ms)`, ok(l.status) && l.ms < SLOW_MS);
    const s = await api("GET", "/items?search=payment&limit=20", { token: T.member });
    check(`full-text search < ${SLOW_MS}ms (got ${s.ms}ms)`, ok(s.status) && s.ms < SLOW_MS);
    const fl = await api("GET", "/items?status=OPEN&priority=P0&limit=20", { token: T.member });
    check(`filtered list < ${SLOW_MS}ms (got ${fl.ms}ms)`, ok(fl.status) && fl.ms < SLOW_MS);
    const d = await api("GET", "/dashboard", { token: T.lead });
    check(`dashboard < ${SLOW_MS}ms (got ${d.ms}ms)`, ok(d.status) && d.ms < SLOW_MS);
    const total = await api("GET", "/items?limit=20", { token: T.member });
    check("list never returns more than one page", listOf(total.data).length <= 20);
  });

  await run("13. Dashboard", async () => {
    const d = await api("GET", "/dashboard", { token: T.member });
    check("GET /dashboard → 200", ok(d.status), d);
    const s = JSON.stringify(d.data).toLowerCase();
    check("has 'my items' section", /assigned|my/.test(s), Object.keys(d.data ?? {}));
    check("has unassigned urgent section", /unassigned|urgent/.test(s), Object.keys(d.data ?? {}));
    check("has overdue section", /overdue/.test(s), Object.keys(d.data ?? {}));
    check("has pending approvals section", /approval/.test(s), Object.keys(d.data ?? {}));
    const ld = await api("GET", "/dashboard", { token: T.lead });
    check("lead's dashboard shows the pending approval (item from step 9)", !rejectedItemId || JSON.stringify(ld.data).includes(rejectedItemId), "if dashboard only returns counts, check the count manually");
    if (T.outsider) {
      const od = await api("GET", "/dashboard", { token: T.outsider });
      check("outsider's dashboard doesn't include this team's items", !JSON.stringify(od.data).includes(TAG), od);
    }
  });

  await run("14. Background worker & notifications", async () => {
    const it = await createItem(T.member);
    await claim(it.id, T.member2);
    const n = await waitFor(async () => (await notificationsOf(T.member)).find((x) => itemIdOf(x) === it.id));
    check(`worker created notification for creator when someone else claimed (≤${WORKER_WAIT_MS / 1000}s)`, !!n, "is the worker running? → npm run dev:worker");
    if (!n) return;

    await sleep(3000); // give a buggy worker time to double-process
    const mine = (await notificationsOf(T.member)).filter((x) => itemIdOf(x) === it.id);
    const evIds = mine.map((x) => f(x, "event_id", "eventId")).filter(Boolean);
    check("no duplicate notifications for the same event", evIds.length === 0 ? mine.length === 1 : new Set(evIds).size === evIds.length, mine);

    const other = (await notificationsOf(T.member2)).some((x) => x.id === n.id);
    check("other users can't see my notification in their list", !other);
    const steal = await api("POST", `/notifications/${n.id}/read`, { token: T.member2 });
    check("other user cannot mark my notification read (404)", steal.status === 404 || steal.status === 403, steal);
    const still = (await notificationsOf(T.member)).find((x) => x.id === n.id);
    check("...and it is still unread", !f(still, "read_at", "readAt"), still);

    const rd = await api("POST", `/notifications/${n.id}/read`, { token: T.member });
    check("I can mark my notification read", ok(rd.status), rd);
    const readNow = (await notificationsOf(T.member)).find((x) => x.id === n.id);
    check("read_at is set", !!f(readNow, "read_at", "readAt"), readNow);
    const ra = await api("POST", "/notifications/read-all", { token: T.member });
    check("read-all works", ok(ra.status), ra);
    check("no unread left after read-all", (await notificationsOf(T.member)).every((x) => !!f(x, "read_at", "readAt")));

    const lead = await waitFor(async () => {
      const list = await notificationsOf(T.lead);
      return rejectedItemId ? list.find((x) => itemIdOf(x) === rejectedItemId) : undefined;
    });
    check("leads are notified about approval requests", !!lead, "check recipients for PENDING_APPROVAL events");
  });

  // ---------- summary ----------
  console.log("\n━━━━━━━━━━ SUMMARY ━━━━━━━━━━");
  const sections = [...new Set(results.map((r) => r.section))];
  for (const s of sections) {
    const rs = results.filter((r) => r.section === s);
    const p = rs.filter((r) => r.pass).length;
    console.log(`${p === rs.length ? "✅" : "❌"} ${String(p).padStart(2)}/${String(rs.length).padEnd(2)}  ${s}`);
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("\nFailed:");
    failed.forEach((r) => console.log(`  ❌ [${r.section}] ${r.name}`));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
