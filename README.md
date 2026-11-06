# Find the Promos

A command-line prototype for Kuku's AI Generalist assignment, Problem 1. It scans timestamped microdrama screenplays and ranks candidate clips for editorial review.

## Run

Requires Python 3.10+ and no packages, credentials or network access.

```sh
python3 find_promos.py "/path/to/screenplays" --out raw_outputs/promos.json
```

Use one UTF-8 text file per episode, named like `episode-001-example.txt`. The tool expects tagged timestamp blocks in this format.

```text
**ACTION:**
Start: (00:00.00) | End: (00:02.40)
A guard lunges across the table.
```

Use speaker tags for dialogue and `ACTION` or `CAMERA` for visual beats. The input pack and the screenplay-derived output are distributed separately from this public repo. The output includes script excerpts, so use an appropriate location when sharing it.

## Read the results

- `coverage` reports every scanned episode and its parsed beat count.
- `promos` lists up to one continuous segment per episode. Each entry includes a global rank, ordered episode/start/end coordinates, duration, opening and ending evidence, and scoring rationale.
- `needs_review` marks clips that fell below a hook, ending or standalone-context threshold. They appear after clips that clear all three thresholds. Treat both groups as suggestions for an editor.

## How it works

The parser converts timestamps to integer hundredths of a second. The selector searches 20–60-second windows at beat boundaries, excluding cuts inside tagged dialogue. It scores opening beats that begin within three seconds, ending beats that finish near the cut, and dialogue that conveys recognizable stakes. Hook and ending scores receive the most weight. A small penalty favors short gaps around the evidence and durations near 34 seconds. A scorer can be replaced by implementing the `hook`, `ending` and `context` methods used by `select`.

One continuous clip per episode gives a simple review queue and avoids assumptions about cross-episode continuity. The scoring rules rely on English text and screenplay timestamps. Video playback is needed to confirm whether a cue lands within the first three seconds or a cut feels clean.

## Validation

The prototype parsed 3,727 timed beats from 50 episodes and generated 50 ranked candidates. All clips passed duration, timestamp, dialogue-boundary and evidence-position checks. The run reproduced identical results on the same files. Three clips passed every scoring threshold. The other 47 were flagged for review.

Keyword scoring sometimes mistakes a generic question for suspense and misses a threat expressed as a metaphor. During development, the physical-confrontation rule scored a judge striking a gavel as a strong opener. A narrow guard removed that trigger. The score represents editorial signals and has not been validated against audience retention or conversion.

The shipped prototype runs locally with zero API cost. For longer scripts or more shows, episodes can be processed independently. A semantic scorer could rerank the best few windows per episode to assess standalone clarity and unresolved stakes. Keep timestamp and dialogue-boundary validation in code, and send the resulting shortlist to an editor for video review.

## AI use

OpenAI Codex helped build the tool, run the input pack, and draft the write-up. The prototype uses deterministic rules at runtime.

## Browser prototype and Vercel

Run `npm ci` and `npm run build`, then serve the static `dist` directory (for example, `python3 -m http.server 8000 --directory dist`). Open the page, run the fictional sample or select screenplay files, and download the raw JSON. The browser runs an equivalent JavaScript implementation of the Python scoring rules in a Web Worker. Selected files and generated results stay in the browser.

Import this repository in Vercel with the repository root as the project root. The checked-in configuration builds to `dist`. It contains only the application and fictional demo. Alternatively, run `vercel deploy --prod` in this source directory after signing in to the Vercel CLI.

The full pack returned identical parsed results from the CLI and browser scorer. A local browser smoke test returned the fictional sample's 24-second clip, and the worker surfaced a clear error for a malformed screenplay.
