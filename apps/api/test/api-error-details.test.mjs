import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorDetails } from "../dist/api-error-details.js";

test("unexpected API logs include a bounded error summary without serializing attached data", () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'importerScopes')");
  error.query = "SELECT private_data";
  error.parameters = ["sensitive value"];

  const details = apiErrorDetails(error);
  assert.equal(details.errorName, "TypeError");
  assert.match(details.errorMessage, /importerScopes/u);
  assert.match(details.errorStack, /api-error-details\.test/u);
  assert.equal(Object.hasOwn(details, "query"), false);
  assert.equal(Object.hasOwn(details, "parameters"), false);
});

test("non-Error thrown values are represented without serializing the value", () => {
  const details = apiErrorDetails({ token: "must not be logged" });
  assert.deepEqual(details, { errorName: "object", errorMessage: "Non-Error value thrown" });
});
