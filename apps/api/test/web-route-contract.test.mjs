import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthRoutes } from "../dist/auth.js";
import { registerAuthorization } from "../dist/authorization.js";
import { registerPurchaseOrderReadRoutes } from "../dist/purchase-orders.js";
import { registerProcessReadRoutes } from "../dist/processes.js";
import { registerDataIssueRoutes } from "../dist/data-issues.js";
import { registerAdminUserRoutes } from "../dist/admin-users.js";
import { registerCatalogRoutes } from "../dist/catalog.js";
import { registerRequestRoutes } from "../dist/requests.js";
import { registerSourceAuditRoutes } from "../dist/source-audit.js";
import { registerAdminOutboxRoutes } from "../dist/admin-outbox.js";
import { registerOperationalRoutes } from "../dist/operations.js";
import { registerFollowupRoutes } from "../dist/followup.js";

// Routes called by the Next.js app. Fastify's own router is checked, so a
// missing registration or a changed method fails before a browser test.
const webRoutes = [
  ["GET", "/auth/me"], ["GET", "/auth/csrf"], ["POST", "/auth/local/login"],
  ["POST", "/auth/local/password"], ["POST", "/auth/logout"],
  ["GET", "/api/v1/importers"],
  ["GET", "/api/v1/purchase-orders"], ["GET", "/api/v1/purchase-orders/summary"],
  ["GET", "/api/v1/purchase-orders/:id/overview"],
  ["GET", "/api/v1/purchase-orders/:id/history-items"],
  ["GET", "/api/v1/purchase-orders/:id/operational"],
  ["GET", "/api/v1/purchase-orders/:id/followup"],
  ["POST", "/api/v1/purchase-orders"], ["POST", "/api/v1/purchase-orders/complete"],
  ["PATCH", "/api/v1/purchase-orders/:id"],
  ["POST", "/api/v1/purchase-orders/:id/items"],
  ["PATCH", "/api/v1/purchase-orders/:id/items/:itemId"],
  ["PATCH", "/api/v1/purchase-orders/:id/items/followup"],
  ["PATCH", "/api/v1/purchase-orders/:id/items/:itemId/followup"],
  ["POST", "/api/v1/purchase-orders/:id/allocations"],
  ["PATCH", "/api/v1/purchase-orders/:id/allocations/:allocationId"],
  ["DELETE", "/api/v1/purchase-orders/:id/allocations/:allocationId"],
  ["GET", "/api/v1/processes"], ["GET", "/api/v1/processes/:id"],
  ["GET", "/api/v1/processes/:id/items"], ["GET", "/api/v1/processes/:id/followup"],
  ["POST", "/api/v1/processes"], ["PATCH", "/api/v1/processes/:id"],
  ["PATCH", "/api/v1/processes/:id/followup"],
  ["POST", "/api/v1/processes/:id/close"], ["POST", "/api/v1/processes/:id/reopen"],
  ["POST", "/api/v1/processes/:id/documents"],
  ["PATCH", "/api/v1/processes/:id/documents/:docId"],
  ["DELETE", "/api/v1/processes/:id/documents/:docId"],
  ["GET", "/api/v1/requests"], ["POST", "/api/v1/requests"],
  ["GET", "/api/v1/requests/:id"], ["PATCH", "/api/v1/requests/:id"],
  ["GET", "/api/v1/requests/:id/history"],
  ["GET", "/api/v1/operational-values"], ["POST", "/api/v1/operational-values"],
  ["GET", "/api/v1/data-issues"], ["POST", "/api/v1/data-issues/:id/resolve"],
  ["GET", "/api/v1/source-rows"], ["GET", "/api/v1/source-rows/column-values"],
  ["GET", "/api/v1/reports/summary"],
  ["GET", "/api/v1/pending-import-items"], ["GET", "/api/v1/unassigned-po-items"],
  ["GET", "/api/v1/admin/users"], ["POST", "/api/v1/admin/users"],
  ["PATCH", "/api/v1/admin/users/:id"],
  ["POST", "/api/v1/admin/users/:id/reset-password"],
  ["GET", "/api/v1/admin/importers"], ["GET", "/api/v1/admin/outbox"],
  ["GET", "/api/v1/suppliers/options"], ["GET", "/api/v1/products/options"],
  ...["suppliers", "products", "ncms"].flatMap(resource => [
    ["GET", `/api/v1/${resource}`],
    ["GET", `/api/v1/${resource}/candidates`], ["GET", `/api/v1/${resource}/:id`],
    ["GET", `/api/v1/${resource}/:id/history`],
    ["POST", `/api/v1/${resource}`], ["PATCH", `/api/v1/${resource}/:id`],
  ]),
];

test("all Next.js API calls have a registered API method and path", async t => {
  const app = Fastify();
  t.after(() => app.close());
  const unusedPool = { query() { throw new Error("Route test must not query a database"); } };
  await registerAuthorization(app, unusedPool);
  await registerAuthRoutes(app, unusedPool);
  await registerPurchaseOrderReadRoutes(app, unusedPool);
  await registerProcessReadRoutes(app, unusedPool);
  await registerDataIssueRoutes(app, unusedPool);
  await registerAdminUserRoutes(app, unusedPool);
  await registerCatalogRoutes(app, unusedPool);
  await registerRequestRoutes(app, unusedPool);
  await registerSourceAuditRoutes(app, unusedPool);
  await registerAdminOutboxRoutes(app, unusedPool);
  await registerOperationalRoutes(app, unusedPool);
  await registerFollowupRoutes(app, unusedPool);
  for (const [method, url] of webRoutes) {
    assert.equal(app.hasRoute({ method, url }), true, `${method} ${url} is missing`);
  }
});
