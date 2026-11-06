const files = document.querySelector("#files");
const analyze = document.querySelector("#analyze");
const sample = document.querySelector("#sample");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const list = document.querySelector("#list");
let busy = false;
let rawOutput;

function append(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
}

function show(raw) {
  const data = JSON.parse(raw);
  const flagged = data.promos.filter((promo) => promo.needs_review).length;
  document.querySelector("#summary").textContent =
    `${data.episodes_scanned} episodes scanned · ${data.promos.length} candidates · ${flagged} flagged for review`;
  list.replaceChildren();
  for (const promo of data.promos) {
    const article = document.createElement("article");
    append(article, "h3", `#${promo.rank} · Episode ${promo.episode}`);
    for (const segment of promo.segments) {
      append(article, "p", `${segment.start}–${segment.end} · ${promo.duration_seconds}s`);
    }
    append(article, "p", `Hook — ${promo.hook.script_evidence}`);
    append(article, "p", `Cliffhanger — ${promo.cliffhanger.script_evidence}`);
    append(article, "p", promo.why_it_works);
    append(article, "p", promo.posting_rationale);
    if (promo.needs_review) append(article, "p", "Needs editorial review");
    list.append(article);
  }
  rawOutput = raw;
  results.hidden = false;
}

async function run(selection) {
  busy = true;
  files.disabled = analyze.disabled = sample.disabled = true;
  results.hidden = true;
  list.replaceChildren();
  rawOutput = undefined;
  status.textContent = "Loading the analysis engine…";
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
    show(raw);
    status.textContent = "Analysis complete.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    worker?.terminate();
    busy = false;
    files.disabled = sample.disabled = false;
    analyze.disabled = files.files.length === 0;
  }
}

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
