import { copyFile, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
const assets = ["index.html", "style.css", "app.js", "judge-client.js", "hybrid.js", "worker.js", "scorer.js", "scoring-rules.json", "episode-001-sample.txt"];
await Promise.all(assets.map((file) => copyFile(file, `dist/${file}`)));
