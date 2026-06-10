import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DEFAULT_HTTP_IDLE_TIMEOUT_MS, httpIdleDispatcherOptions } from "../src/http-idle-timeout.ts";

test("defaults to the pi CLI idle timeout on body and headers", () => {
  const opts = httpIdleDispatcherOptions();
  assert.equal(opts.bodyTimeout, DEFAULT_HTTP_IDLE_TIMEOUT_MS);
  assert.equal(opts.headersTimeout, DEFAULT_HTTP_IDLE_TIMEOUT_MS);
  assert.equal(opts.allowH2, false);
});

test("applies a custom finite timeout to body and headers", () => {
  const opts = httpIdleDispatcherOptions(120_000);
  assert.equal(opts.bodyTimeout, 120_000);
  assert.equal(opts.headersTimeout, 120_000);
});

test("0 is preserved (undici treats 0 as no timeout)", () => {
  assert.equal(httpIdleDispatcherOptions(0).bodyTimeout, 0);
});

test("invalid timeouts fall back to the default", () => {
  assert.equal(httpIdleDispatcherOptions(Number.NaN).bodyTimeout, DEFAULT_HTTP_IDLE_TIMEOUT_MS);
  assert.equal(httpIdleDispatcherOptions(-5).bodyTimeout, DEFAULT_HTTP_IDLE_TIMEOUT_MS);
});

test("floors fractional timeouts", () => {
  assert.equal(httpIdleDispatcherOptions(1500.9).bodyTimeout, 1500);
});
