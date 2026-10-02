import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerDataIssueRoutes } from "../dist/data-issues.js";

const issueIds = {
  visible: "00000000-0000-4000-8000-000000000001",
  hidden: "00000000-0000-4000-8000-000000000002",
};
const scopesBySubject = {
  master: [{ role: "Master", importer_code: null }],
  buyerA: [{ role: "Compras", importer_code: "ELETRA MATRIZ" }],
  buyerB: [{ role: "Compras", importer_code: "ELETRA FOR" }],
  reader: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }],
};

function sortJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${sortJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function resolutionHash(issueId, body) {
  return createHash("sha256").update(sortJson({
    issueId,
    evidence: body.evidence,
    reason: body.reason,
    proposedPurchaseOrder: body.proposedPurchaseOrder ?? null,
    proposedIpNumber: body.proposedIpNumber ?? null,
  })).digest("hex");
}

async function createApp({ failOutbox = false } = {}) {
  const state = { issueStatus: "OPEN", reviews: new Map(), queries: [], commits: 0, rollbacks: 0, listSql: "" };
  const issue = {
    id: issueIds.visible,
    batch_id: "00000000-0000-4000-8000-000000000010",
    source_row_id: "00000000-0000-4000-8000-000000000011",
    issue_code: "BAD_DATE",
    status: "OPEN",
    evidence: { source: "Excel" },
  };
  const pool = {
    async query(sql, values) {
      if (sql.includes("identity.erp_user_role")) {
        const subject = values[1];
        return { rows: scopesBySubject[subject] ?? [] };
      }
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }] };
      }
      state.listSql = sql;
      return { rows: [{ total_count: 1, open_count: 1, resolved_count: 0, items: [{ id: issue.id }] }] };
    },
    async connect() {
      const staged = {};
      return {
        async query(sql, values = []) {
          state.queries.push({ sql, values });
          if (sql === "BEGIN") return { rows: [] };
          if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
          if (sql.includes("FROM migration.quality_review AS review") && sql.includes("reviewer_user_id")) {
            const review = state.reviews.get(`${values[0]}:${values[1]}`);
            return { rowCount: review ? 1 : 0, rows: review ? [review] : [] };
          }
          if (sql.includes("FROM migration.data_issue AS issue")) {
            if (sql.includes("AND (TRUE)")) {
              return { rowCount: values[0] === issue.id ? 1 : 0,
                rows: values[0] === issue.id ? [{ ...issue, status: state.issueStatus }] : [] };
            }
            assert.match(sql, /po\.importer = ANY\(\$2::text\[\]\)/u);
            assert.match(sql, /process\.importer = ANY\(\$3::text\[\]\)/u);
            const allowed = [...values[1], ...values[2]].includes("ELETRA MATRIZ");
            return { rowCount: values[0] === issue.id && allowed ? 1 : 0, rows: values[0] === issue.id && allowed ? [{ ...issue, status: state.issueStatus }] : [] };
          }
          if (sql.includes("INSERT INTO migration.quality_review")) {
            staged.review = {
              id: values[0], issueId: values[1], recorded_at: values[9],
              payload_sha256: values[13], userId: values[11], key: values[12],
            };
            return { rowCount: 1, rows: [] };
          }
          if (sql.startsWith("UPDATE migration.data_issue")) {
            staged.issueStatus = "RESOLVED";
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("INSERT INTO audit.audit_log")) return { rowCount: 1, rows: [] };
          if (sql.includes("INSERT INTO audit.outbox_message")) {
            if (failOutbox) throw new Error("simulated outbox insert failure");
            return { rowCount: 1, rows: [] };
          }
          if (sql === "COMMIT") {
            state.commits += 1;
            if (staged.review) state.reviews.set(`${staged.review.userId}:${staged.review.key}`, staged.review);
            if (staged.issueStatus) state.issueStatus = staged.issueStatus;
            return { rows: [] };
          }
          if (sql === "ROLLBACK") {
            state.rollbacks += 1;
            return { rows: [] };
          }
          throw new Error(`Unexpected SQL in test double: ${sql}`);
        },
        release() {},
      };
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async (request) => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") {
      request.authContext = {
        issuer: "issuer:test", subject, userId: `user:${subject}`,
        displayName: "Revisor autenticado", sessionToken: "test-only",
      };
    }
  });
  await registerDataIssueRoutes(app, pool);
  return { app, state };
}

const baseBody = { evidence: { document: "INV-123" }, reason: "Data conferida com invoice." };
const headers = (subject, key) => ({
  ...(subject ? { "x-test-subject": subject } : {}),
  "idempotency-key": key,
  "content-type": "application/json",
});

test("quality list scopes before counts and pagination", async (t) => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/v1/data-issues?pageSize=1", headers: { "x-test-subject": "buyerA" } });
  assert.equal(response.statusCode, 200);
  assert.ok(state.listSql.indexOf("WHERE (EXISTS (") < state.listSql.indexOf("LIMIT $5 OFFSET $6"));
  assert.match(state.listSql, /SELECT count\(\*\)::int FROM filtered/u);
  assert.deepEqual(response.json().items, [{ id: issueIds.visible, sourceColumnHeaders: {} }]);
});

test("master can see and resolve historical issues without a PO or IP", async (t) => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const list = await app.inject({ method: "GET", url: "/api/v1/data-issues", headers: { "x-test-subject": "master" } });
  assert.equal(list.statusCode, 200);
  assert.match(state.listSql, /WHERE \(TRUE\)/u);
  const resolve = await app.inject({ method: "POST", url: `/api/v1/data-issues/${issueIds.visible}/resolve`,
    headers: headers("master", "master-unlinked-key"), payload: baseBody });
  assert.equal(resolve.statusCode, 201);
  assert.ok(state.queries.some(({ sql }) => sql.includes("AND (TRUE)")));
});

test("quality resolve returns 401/403 before opening a write transaction", async (t) => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const url = `/api/v1/data-issues/${issueIds.visible}/resolve`;
  const unauthenticated = await app.inject({ method: "POST", url, headers: headers(undefined, "key-1"), payload: baseBody });
  const forbidden = await app.inject({ method: "POST", url, headers: headers("reader", "key-2"), payload: baseBody });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(state.queries.length, 0);
});

test("resolution requires non-empty evidence, a reason, and an idempotency key", async (t) => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const url = `/api/v1/data-issues/${issueIds.visible}/resolve`;
  const noEvidence = await app.inject({ method: "POST", url, headers: headers("buyerA", "key-a"), payload: { evidence: {}, reason: "Checked." } });
  const noReason = await app.inject({ method: "POST", url, headers: headers("buyerA", "key-b"), payload: { evidence: { document: "INV-123" }, reason: "   " } });
  const noKey = await app.inject({ method: "POST", url, headers: { "x-test-subject": "buyerA", "content-type": "application/json" }, payload: baseBody });
  assert.equal(noEvidence.statusCode, 400);
  assert.equal(noReason.statusCode, 400);
  assert.equal(noKey.statusCode, 400);
  assert.equal(state.queries.length, 0);
});

test("hidden issues return 404 before an idempotency conflict can disclose resource state", async (t) => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const first = await app.inject({ method: "POST", url: `/api/v1/data-issues/${issueIds.visible}/resolve`, headers: headers("buyerA", "shared-key"), payload: baseBody });
  const response = await app.inject({ method: "POST", url: `/api/v1/data-issues/${issueIds.hidden}/resolve`, headers: headers("buyerA", "shared-key"), payload: { ...baseBody, reason: "Outro payload." } });
  const otherImporter = await app.inject({ method: "POST", url: `/api/v1/data-issues/${issueIds.visible}/resolve`, headers: headers("buyerB", "other-key"), payload: baseBody });
  assert.equal(first.statusCode, 201);
  assert.equal(response.statusCode, 404);
  assert.equal(otherImporter.statusCode, 404);
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 2);
});

test("resolution records session identity and supports replay and payload conflict", async (t) => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const url = `/api/v1/data-issues/${issueIds.visible}/resolve`;
  const first = await app.inject({ method: "POST", url, headers: headers("buyerA", "stable-key"), payload: baseBody });
  const replay = await app.inject({ method: "POST", url, headers: headers("buyerA", "stable-key"), payload: baseBody });
  const conflict = await app.inject({ method: "POST", url, headers: headers("buyerA", "stable-key"), payload: { ...baseBody, reason: "Outra justificativa." } });
  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, first.json().id);
  assert.equal(conflict.statusCode, 409);
  const insert = state.queries.find(({ sql }) => sql.includes("INSERT INTO migration.quality_review"));
  assert.equal(insert.values[5], "Revisor autenticado");
  assert.equal(insert.values[11], "user:buyerA");
  assert.equal(insert.values[13], resolutionHash(issueIds.visible, baseBody));
  assert.equal(state.commits, 3);
});

test("outbox failure rolls back the review and issue resolution", async (t) => {
  const { app, state } = await createApp({ failOutbox: true });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: `/api/v1/data-issues/${issueIds.visible}/resolve`, headers: headers("buyerA", "rollback-key"), payload: baseBody });
  assert.equal(response.statusCode, 500);
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.issueStatus, "OPEN");
  assert.equal(state.reviews.size, 0);
});
