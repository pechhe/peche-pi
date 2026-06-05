import { strict as assert } from "node:assert";
import { test } from "node:test";

import { summarizeRunError } from "../src/session-supervisor-utils.ts";

const USAGE_LIMIT =
  'Codex error: {"type":"error","error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"team","resets_at":1780682187,"eligible_promo":null,"resets_in_seconds":13574},"status_code":429,"headers":{"X-Codex-Active-Limit":"premium"}}';

test("collapses a usage_limit_reached blob into a single line with reset ETA", () => {
  assert.equal(summarizeRunError(USAGE_LIMIT), "Usage limit reached — resets in 3h 46m");
});

test("falls back to the inner message for other structured errors", () => {
  const raw = 'API error: {"error":{"type":"invalid_request","message":"Bad request"},"status_code":400}';
  assert.equal(summarizeRunError(raw), "Bad request");
});

test("leaves plain messages untouched", () => {
  assert.equal(summarizeRunError("Run aborted"), "Run aborted");
});

test("returns the original text when the payload is not valid JSON", () => {
  const raw = "Codex error: {not json";
  assert.equal(summarizeRunError(raw), raw);
});

test("formats reset durations across day/hour/minute boundaries", () => {
  const make = (seconds: number) =>
    summarizeRunError(
      `Codex error: {"error":{"type":"usage_limit_reached","resets_in_seconds":${seconds}}}`,
    );
  assert.equal(make(90061), "Usage limit reached — resets in 1d 1h");
  assert.equal(make(3661), "Usage limit reached — resets in 1h 1m");
  assert.equal(make(120), "Usage limit reached — resets in 2m");
  assert.equal(make(45), "Usage limit reached — resets in 45s");
});
