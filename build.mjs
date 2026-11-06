import { copyFile, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/runtime", { recursive: true });
const assets = ["index.html", "style.css", "app.js", "worker.js", "find_promos.py", "episode-001-sample.txt"];
const runtime = ["pyodide.js", "pyodide.asm.js", "pyodide.asm.wasm", "pyodide-lock.json", "python_stdlib.zip"];
await Promise.all([
  ...assets.map((file) => copyFile(file, `dist/${file}`)),
  ...runtime.map((file) => copyFile(`node_modules/pyodide/${file}`, `dist/runtime/${file}`)),
]);
