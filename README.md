# Find the Promos

A hybrid rule + Gemini judge for Kuku's AI Generalist assignment, Problem 1.

[Open the deployed app](https://find-the-promos.vercel.app/)

## Use the app

Select one or more timestamped screenplay text files named like `episode-001-example.txt`, or try the fictional sample. Rules propose up to three different 20–60 second cuts per episode. With **Add Gemini AI review** enabled, candidate excerpts are sent through the server to Google Gemini. The app chooses one candidate per episode and ranks the choices across the show.

Each result shows the episode, exact cut points, opening and ending script evidence, Gemini's assessment, scores and a limitation. Download the JSON for the rule baseline, all candidate cuts, model responses, usage metadata and final ranking. You can stop AI review or retry remaining candidates after a failure. Successful reviews from the current run stay in memory while the page remains open.

## How the judges work

The rule engine parses integer timestamps, excludes cuts through dialogue and searches windows at beat boundaries. English cues favor confrontations, danger, betrayal and imminent action. A duration preference and dialogue context proxy complete the rule score. It greedily selects three windows with overlap-over-union no greater than 0.65.

Gemini judges the actual excerpt for hook strength within three seconds, unresolved suspense at the ending and clarity for a new viewer. It returns integer scores from 0 to 10, a reason, a limitation and explicit index references to supplied script beats. Each beat is annotated with opening/ending timing eligibility. It cannot change the candidate timestamps. Code rejects unknown candidate ids, duplicate ids, incomplete responses, invalid scores. Invalid beat indices are normalized to missing evidence and force editorial review, while the raw model response is retained. References outside opening/ending timing constraints force editorial review.

The combined score uses 75% Gemini and 25% rules. Gemini's component weights hook and cliffhanger at 40% each and clarity at 20%. Rule scores are scaled against 44 and clamped to 0–100. These weights and thresholds are implementation choices, without audience-metric calibration. A Gemini score below 6 on any dimension or invalid timed evidence marks a selection for review. Reviewed candidates appear before rule-only fallbacks, with passing selections first within those groups.

AI assesses only the rule-generated shortlist. It can miss a better scene excluded by the rules, misjudge story meaning or vary between runs. Script timing still needs verification against footage. Editor acceptance and later retention/click-through data would provide stronger evaluation.

## Run and deploy

The offline Python baseline needs Python 3.10+ with no packages.

```sh
python3 find_promos.py "/path/to/screenplays" --out raw_outputs/promos.json
```

The browser UI and server function use Node.js 22+ and Vercel. Set `GEMINI_API_KEY` as a **Production secret** in the Vercel project. Optionally set `GEMINI_MODEL` to a compatible Gemini model. The default is `gemini-3.5-flash-lite`. Keep secrets in Vercel or ignored local environment files.

```sh
npm ci
npm run build
node --test test/judge.test.mjs
npx vercel dev
```

Use `npx vercel deploy --prod` to deploy the repository root. The `api/judge.mjs` server function needs a Vercel source deployment. A static folder upload alone cannot run the API.

The API batches up to ten candidates and bounds request size, script lengths, model output and timeout. Model availability, quota and usage cost depend on the configured Google account. If AI fails, the UI keeps completed reviews and rule-only suggestions and labels their source.

## Quality and AI disclosure

The original rule baseline scanned all 50 provided episodes and parsed 3,727 beats. Its browser and Python results matched. The updated shortlist yields 150 candidates across the same episodes. Hard timing constraints are validated before judging. The tests exercise hallucinated ids, score ranges, evidence timing, dialogue boundaries, API failures and selection changes.

OpenAI Codex helped implement, test and document the tool. During initial development, a confrontation rule mistook a judge striking a gavel for violence, which prompted a narrow correction. Runtime semantic judging is performed by Gemini with an explicit rubric and structured response schema. Source screenplays and outputs containing Kuku excerpts are shared separately with reviewers.

The final full-pack run obtained 150 Gemini Flash-Lite reviews, selected 50 clips, flagged nine selections and changed the preferred cut in 15 episodes. An initial run exposed frequent incorrect ending references. Explicit beat indices and timing eligibility were added, and the final run retained three invalid references for editorial review. A model change followed the first model's daily free-tier quota limit. Both runs are preserved for audit. These measurements describe this run's selections and validation, with audience impact awaiting editor and viewer evaluation.
