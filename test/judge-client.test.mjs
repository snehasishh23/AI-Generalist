import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const code = await readFile(new URL("../judge-client.js", import.meta.url), "utf8");
function client(fetch) {
  const context = vm.createContext({
    fetch, DOMException, setTimeout: (callback) => setTimeout(callback, 0), clearTimeout,
  });
  vm.runInContext(code, context);
  return context.requestJudgeBatch;
}

test("a temporary Gemini 503 retries the same batch and returns its eventual result", async () => {
  let calls = 0;
  const request = client(async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).candidates[0].id, "clip-1");
    return calls === 1
      ? new Response(JSON.stringify({ error: "busy", upstream_status: 503 }), { status: 502 })
      : new Response(JSON.stringify({ judgments: [{ id: "clip-1" }] }));
  });
  const retries = [];
  const result = await request([{ id: "clip-1" }], new AbortController().signal, (n) => retries.push(n));
  assert.equal(calls, 2);
  assert.deepEqual(retries, [1]);
  assert.equal(result.judgments[0].id, "clip-1");
});

test("quota failures are surfaced immediately without retrying", async () => {
  let calls = 0;
  const request = client(async () => {
    calls++;
    return new Response(JSON.stringify({ quota_limits: ["GenerateRequestsPerDayPerProjectPerModel-FreeTier"] }), { status: 429 });
  });
  await assert.rejects(request([], new AbortController().signal, () => assert.fail("quota retry")), /daily quota/);
  assert.equal(calls, 1);
});

test("repeated 503 failures stop after three attempts", async () => {
  let calls = 0;
  const request = client(async () => {
    calls++;
    return new Response(JSON.stringify({ error: "Gemini unavailable", upstream_status: 503 }), { status: 502 });
  });
  await assert.rejects(request([], new AbortController().signal, () => {}), /unavailable/);
  assert.equal(calls, 3);
});

test("stopping during backoff prevents another provider request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const request = client(async () => {
    calls++;
    return new Response(JSON.stringify({ upstream_status: 503 }), { status: 502 });
  });
  await assert.rejects(request([], controller.signal, () => controller.abort()), { name: "AbortError" });
  assert.equal(calls, 1);
});
