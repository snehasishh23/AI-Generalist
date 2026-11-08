import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { validateCandidates, validateJudgments, judgeCandidates } from "../api/judge.mjs";

const source = {
  id: "ep-1-clip-1", episode: 1,
  segments: [{ episode: 1, start: "00:00.00", end: "00:24.00" }],
  clip_beats: [
    { start: "00:00.00", end: "00:02.00", speaker: "ACTION", text: "A guard lunges." },
    { start: "00:02.00", end: "00:10.00", speaker: "MAYOR", text: "Give me the letter." },
    { start: "00:17.00", end: "00:24.00", speaker: "ACTION", text: "She raises a dagger." },
  ],
};
const judgment = {
  id: source.id, hook_score: 8, cliffhanger_score: 8, clarity_score: 7,
  hook_beat: 0, ending_beat: 2, hook: "Immediate conflict.", cliffhanger: "The dagger threatens the guard.",
  why_it_works: "The letter creates stakes.", limitation: "The letter's contents are unknown.",
};

test("AI cannot add candidates, repeat candidates or return scores outside the rubric", () => {
  const input = validateCandidates([source]);
  assert.throws(() => validateJudgments([{ ...judgment, id: "ep-9-clip-1" }], input));
  assert.throws(() => validateJudgments([{ ...judgment, hook_score: 11 }], input));
  assert.throws(() => validateJudgments([{ ...judgment, hook_beat: 99 }], input));
  assert.throws(() => validateJudgments([judgment, judgment], [input[0], input[0]]));
});

test("AI evidence is checked against the actual hook and ending timing", () => {
  const input = validateCandidates([source]);
  const [valid] = validateJudgments([judgment], input);
  assert.equal(valid.hook_evidence_valid, true);
  assert.equal(valid.ending_evidence_valid, true);
  const [late] = validateJudgments([{ ...judgment, hook_beat: 2, ending_beat: 1 }], input);
  assert.equal(late.hook_evidence_valid, false);
  assert.equal(late.ending_evidence_valid, false);
});

test("malformed clip bounds and cuts through dialogue are rejected before an API call", () => {
  assert.throws(() => validateCandidates([{ ...source, segments: [{ episode: 1, start: "00:00.00", end: "00:19.00" }] }]));
  const bad = structuredClone(source);
  bad.clip_beats[1].start = "00:00.00";
  bad.segments[0] = { episode: 1, start: "00:01.00", end: "00:24.00" };
  assert.throws(() => validateCandidates([bad]), /cuts through dialogue/);
});

test("Gemini requests use a server credential and structured output", async () => {
  const result = await judgeCandidates([source], {
    apiKey: "test-key",
    fetch: async (url, options) => {
      assert.equal(options.headers["x-goog-api-key"], "test-key");
      assert.ok(!url.includes("test-key"));
      const body = JSON.parse(options.body);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      const supplied = JSON.parse(body.contents[0].parts[0].text).candidates[0];
      assert.equal(supplied.clip_beats[2].index, 2);
      assert.equal(supplied.clip_beats[2].can_support_ending, true);
      assert.equal(supplied.clip_beats[0].can_support_ending, false);
      return new Response(JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ judgments: [judgment] }) }] } }],
        modelVersion: "test-model",
      }));
    },
  });
  assert.equal(result.model, "test-model");
  assert.equal(result.judgments[0].ending_evidence_valid, true);
});

test("Gemini quota and truncated output fail clearly", async () => {
  await assert.rejects(judgeCandidates([source], { apiKey: "test-key", fetch: async () => new Response("", { status: 429 }) }), /quota/);
  await assert.rejects(judgeCandidates([source], { apiKey: "test-key", fetch: async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }] })) }), /complete review/);
});

test("combining reviews can change the selected cut while preserving fixed timestamps and baseline", async () => {
  const context = vm.createContext({});
  vm.runInContext(await readFile(new URL("../hybrid.js", import.meta.url), "utf8"), context);
  const first = { ...source, score: 30, needs_review: false, hook: {}, cliffhanger: {} };
  const alternate = { ...source, id: "ep-1-clip-2", score: 20, needs_review: true, hook: {}, cliffhanger: {} };
  const baseline = { promos: [{ ...first, rank: 1 }], candidates: [first, alternate], episodes_scanned: 1 };
  const reviews = [
    { ...judgment, hook_score: 2, cliffhanger_score: 2, clarity_score: 2, hook_evidence_valid: true, ending_evidence_valid: true },
    { ...judgment, id: alternate.id, hook_evidence_valid: true, ending_evidence_valid: true },
  ];
  const output = context.combineJudgments(baseline, reviews);
  assert.equal(output.promos[0].id, alternate.id);
  assert.equal(output.rule_baseline[0].id, first.id);
  assert.equal(output.ai.status, "complete");
  assert.deepEqual(output.promos[0].segments, alternate.segments);
  const fallback = context.combineJudgments(baseline, []);
  assert.equal(fallback.promos[0].judgment_source, "rules_only");
  assert.equal(fallback.ai.status, "not_run");
});
