self.onmessage = async ({ data: files }) => {
  try {
    importScripts("runtime/pyodide.js");
    const python = await loadPyodide({ indexURL: new URL("runtime/", self.location.href).href });
    const response = await fetch("find_promos.py");
    if (!response.ok) throw new Error("Could not load the scorer.");
    python.FS.writeFile("/find_promos.py", await response.text());
    python.FS.mkdir("/inputs");
    for (const file of files) {
      python.FS.writeFile(`/inputs/${file.name}`, new Uint8Array(file.bytes));
    }
    self.postMessage({ phase: `Scoring ${files.length} screenplay file(s)…` });
    const raw = python.runPython(`
import sys
sys.path.insert(0, "/")
from find_promos import Path, RuleScorer, json, run
json.dumps(run(Path("/inputs"), RuleScorer()), ensure_ascii=False, indent=2) + "\\n"
`);
    self.postMessage({ raw });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
