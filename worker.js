self.onmessage = async ({ data: files }) => {
  try {
    self.postMessage({ phase: `Scoring ${files.length} screenplay file(s)…` });
    importScripts("scorer.js");
    const response = await fetch("scoring-rules.json");
    if (!response.ok) throw new Error("Could not load the scoring rules.");
    const data = rankPromos(files, await response.json());
    self.postMessage({ raw: JSON.stringify(data, null, 2) + "\n" });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
