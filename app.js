const files = document.querySelector("#files");
const analyze = document.querySelector("#analyze");
const sample = document.querySelector("#sample");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const list = document.querySelector("#list");
const aiEnabled = document.querySelector("#ai-enabled");
const reviewButton = document.querySelector("#review");
const cancelButton = document.querySelector("#cancel");
let busy = false;
let rawOutput;
let baseline;
let reviews = [];
let batches = [];
let controller;

function append(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
}

function show(data) {
  const flagged = data.promos.filter((promo) => promo.needs_review).length;
  document.querySelector("#summary").textContent =
    data.episodes_scanned + " episodes scanned · " + data.promos.length + " selected clips · " +
    flagged + " flagged for review" +
    (data.ai ? " · Gemini reviewed " + data.ai.reviewed_candidates + "/" + data.ai.candidate_count + " candidates" : " · Rules only");
  list.replaceChildren();
  for (const promo of data.promos) {
    const article = document.createElement("article");
    append(article, "h3", "#" + promo.rank + " · Episode " + promo.episode);
    for (const segment of promo.segments) {
      append(article, "p", segment.start + "–" + segment.end + " · " + promo.duration_seconds + "s");
    }
    append(article, "p", promo.ai_review ? "Judged by rules + Gemini" : "Judged by rules only");
    append(article, "p", "Hook — " + promo.hook.script_evidence);
    if (promo.hook.ai_assessment) append(article, "p", promo.hook.ai_assessment);
    append(article, "p", "Cliffhanger — " + promo.cliffhanger.script_evidence);
    if (promo.cliffhanger.ai_assessment) append(article, "p", promo.cliffhanger.ai_assessment);
    append(article, "p", promo.why_it_works);
    append(article, "p", promo.posting_rationale);
    if (promo.ai_review) append(article, "p", "AI limitation — " + promo.ai_review.limitation);
    if (promo.ai_review && (!promo.ai_review.hook_evidence_valid || !promo.ai_review.ending_evidence_valid)) {
      append(article, "p", "AI evidence needs review. An opening or ending reference fell outside the allowed timing.");
    }
    if (promo.needs_review) append(article, "p", "Needs editorial review");
    list.append(article);
  }
  rawOutput = JSON.stringify(data, null, 2) + "\n";
  results.hidden = false;
  reviewButton.hidden = !baseline?.candidates?.length ||
    reviews.length === baseline.candidates.length;
}

function setBusy(value) {
  busy = value;
  files.disabled = sample.disabled = aiEnabled.disabled = reviewButton.disabled = value;
  analyze.disabled = value || files.files.length === 0;
  cancelButton.hidden = !value || !controller;
}

async function reviewWithAI() {
  if (busy && controller) return;
  if (!baseline?.candidates.length) return;
  controller = new AbortController();
  setBusy(true);
  const completed = new Set(reviews.map((review) => review.id));
  const pending = baseline.candidates.filter((candidate) => !completed.has(candidate.id));
  try {
    for (let offset = 0; offset < pending.length; offset += 10) {
      status.textContent = "Gemini reviewing candidates · " + reviews.length + "/" +
        baseline.candidates.length + " complete…";
      const batch = pending.slice(offset, offset + 10);
      const data = await requestJudgeBatch(batch, controller.signal, (retry) => {
        status.textContent = "Gemini is temporarily busy. Retrying this batch (" + retry + "/2)…";
      });
      const batchIds = new Set(batch.map((candidate) => candidate.id));
      if (!Array.isArray(data.judgments) || data.judgments.length !== batchIds.size ||
          new Set(data.judgments.map((judgment) => judgment.id)).size !== batchIds.size ||
          data.judgments.some((judgment) => !batchIds.has(judgment.id))) throw new Error("Incomplete AI review.");
      reviews.push(...data.judgments);
      batches.push({ model: data.model, usage: data.usage, rubric_version: data.rubric_version, raw_response: data.raw_response, candidate_ids: [...batchIds] });
      show(combineJudgments(baseline, reviews, batches));
    }
    status.textContent = "Combined rule + Gemini review complete.";
  } catch (error) {
    show(combineJudgments(baseline, reviews, batches));
    status.textContent = error.name === "AbortError"
      ? "AI review stopped. Completed reviews and rule results are available."
      : error.message + " Completed reviews and rule results are available.";
  } finally {
    controller = undefined;
    setBusy(false);
  }
}

async function run(selection) {
  setBusy(true);
  results.hidden = true;
  list.replaceChildren();
  baseline = undefined;
  reviews = [];
  batches = [];
  rawOutput = undefined;
  reviewButton.hidden = true;
  status.textContent = "Finding candidate clips…";
  let worker;
  try {
    const inputs = await selection();
    worker = new Worker("worker.js");
    const raw = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.phase) status.textContent = data.phase;
        else if (data.error) reject(new Error(data.error));
        else resolve(data.raw);
      };
      worker.onerror = () => reject(new Error("Could not load the analysis engine."));
      worker.postMessage(inputs);
    });
    baseline = JSON.parse(raw);
    show(baseline);
    status.textContent = "Rule selection complete.";
    if (aiEnabled.checked) await reviewWithAI();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    worker?.terminate();
    setBusy(false);
  }
}

reviewButton.addEventListener("click", reviewWithAI);
cancelButton.addEventListener("click", () => controller?.abort());
files.addEventListener("change", () => {
  analyze.disabled = busy || files.files.length === 0;
});
analyze.addEventListener("click", () => run(async () => {
  const picked = [...files.files];
  if (picked.some((file) => !/^episode-\d+(?=[-.]).*\.txt$/.test(file.name))) {
    throw new Error("Use episode text files named like episode-001-example.txt.");
  }
  if (new Set(picked.map((file) => file.name)).size !== picked.length) {
    throw new Error("Select each filename once.");
  }
  return Promise.all(picked.map(async (file) => ({ name: file.name, bytes: await file.arrayBuffer() })));
}));
sample.addEventListener("click", () => run(async () => {
  const response = await fetch("episode-001-sample.txt");
  if (!response.ok) throw new Error("Could not load the sample.");
  return [{ name: "episode-001-sample.txt", bytes: await response.arrayBuffer() }];
}));
document.querySelector("#download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([rawOutput], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "promos.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
