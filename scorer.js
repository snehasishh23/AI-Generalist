/* Browser implementation of the continuous-window scorer in find_promos.py. */
const stamp = "(\\d+:\\d{2}\\.\\d{2})";
const blocks = new RegExp(
  `^\\*\\*(.+?):\\*\\*[ \\t]*\\nStart: \\(${stamp}\\) \\| End: \\(${stamp}\\)[ \\t]*\\n` +
  "([\\s\\S]*?)(?=^\\*\\*|^SCENE\\s+\\d|^--- SCRIPT END ---|(?![\\s\\S]))",
  "gm",
);
const nonStory = new Set(["SOUND FX", "MUSIC", "TEXT OVERLAY"]);
const nonDialogue = new Set(["CAMERA", "ACTION", ...nonStory]);

function ticks(time) {
  const [minutes, seconds] = time.split(":");
  return Number(minutes) * 6000 + Number(seconds.replace(".", ""));
}

function timecode(tick) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(tick / 6000))}:${pad(Math.floor(tick / 100) % 60)}.${pad(tick % 100)}`;
}

function parse(file) {
  let section = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes).replace(/\r\n?/g, "\n");
  const startTag = "--- SCRIPT START ---";
  if (section.includes(startTag)) section = section.slice(section.indexOf(startTag) + startTag.length);
  section = section.split("--- SCRIPT END ---", 1)[0];
  const beats = [...section.matchAll(blocks)].map(([, speaker, start, end, text]) => ({
    start: ticks(start), end: ticks(end), speaker: speaker.trim(), text: text.trim().replace(/\s+/g, " "),
  }));
  if (!beats.length || beats.length !== (section.match(/^Start:/gm) || []).length) {
    throw new Error(`${file.name} contains missing or unrecognized timestamp blocks`);
  }
  if (beats.some((beat) => beat.start >= beat.end || !beat.text)) {
    throw new Error(`${file.name} contains an empty or invalid beat`);
  }
  return beats.sort((a, b) => a.start - b.start || a.end - b.end);
}

function compare(a, b) {
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function signal(beat, rules, fallback) {
  let best = [0, fallback];
  for (const [label, weight, pattern] of rules) {
    if (pattern.test(beat.text) && compare([weight, label], best) > 0) best = [weight, label];
  }
  return best;
}

function evidence(beat, cue) {
  return { cue, start: timecode(beat.start), end: timecode(beat.end), speaker: beat.speaker, script_evidence: beat.text };
}

function select(beats, rules) {
  const dialogue = beats.filter((beat) => !nonDialogue.has(beat.speaker));
  const story = beats.filter((beat) => !nonStory.has(beat.speaker));
  const hooks = story.map((beat) => {
    let [weight, label] = signal(beat, rules.hooks, "opening beat");
    if (beat.speaker === "CAMERA") weight = Math.max(0, weight - 2);
    if (label === "physical confrontation" && /\bgavel\b/i.test(beat.text)) [weight, label] = [0, "opening beat"];
    if (!nonDialogue.has(beat.speaker) && rules.dependent.test(beat.text)) weight = Math.max(0, weight - 1);
    return { beat, weight, label };
  });
  const endings = story.map((beat) => {
    let [weight, label] = signal(beat, rules.ending, "closing beat");
    if (rules.closure.test(beat.text)) weight -= 2;
    if (beat.speaker === "CAMERA") weight -= 1;
    return { beat, weight, label };
  });
  const clean = (point) => !dialogue.some((beat) => beat.start < point && point < beat.end);
  const starts = [...new Set([0, ...story.map((beat) => beat.start).filter(clean)])].sort((a, b) => a - b);
  const ends = [...new Set(story.map((beat) => beat.end).filter(clean))].sort((a, b) => a - b);
  const duration = Math.max(...beats.map((beat) => beat.end));
  let best = null;
  for (const start of starts) {
    const opening = hooks.reduce((top, item, index) => {
      if (item.beat.start < start || item.beat.start >= start + 300) return top;
      const key = [item.weight, -item.beat.start, item.label, index];
      return !top || compare(key, top.key) > 0 ? { ...item, key } : top;
    }, null);
    if (!opening) continue;
    for (const end of ends) {
      const length = end - start;
      if (length < 2000 || length > 6000) continue;
      const closing = endings.reduce((top, item, index) => {
        if (item.beat.end < end - 220 || item.beat.end > end || item.beat.start < start) return top;
        const key = [item.weight, item.beat.end, item.label, index];
        return !top || compare(key, top.key) > 0 ? { ...item, key } : top;
      }, null);
      if (!closing) continue;
      const lines = dialogue.filter((beat) => beat.start >= start && beat.end <= end);
      const stakes = new Set(lines.flatMap((beat) => (beat.text.match(rules.stakes) || []).map((word) => word.toLowerCase())));
      const context = Math.min(3, stakes.size) + Number(lines.length >= 3);
      const score = 3 * opening.weight + 3 * closing.weight + 2 * context
        + Number(end === duration) - Math.abs(length - 3400) / 1000
        - (opening.beat.start - start + end - closing.beat.end) / 250;
      const key = [score, opening.weight, closing.weight, -start, -end];
      if (!best || compare(key, best.key) > 0) best = { key, start, end, opening, closing, context };
    }
  }
  if (!best) return null;
  const { key, start, end, opening, closing, context } = best;
  const review = opening.weight < 4 || closing.weight < 4 || context < 2;
  return {
    segments: [{ start: timecode(start), end: timecode(end) }],
    duration_seconds: (end - start) / 100,
    hook: evidence(opening.beat, opening.label),
    cliffhanger: evidence(closing.beat, closing.label),
    why_it_works: review
      ? `Review the ${opening.label} opener and ${closing.label} ending for editorial fit.`
      : `Opens with ${opening.label} and cuts on ${closing.label}.`,
    posting_rationale: `Hook ${opening.weight}/6, ending ${closing.weight}/6, standalone-context proxy ${context}/4.`,
    score: Number(key[0].toFixed(3)),
    hook_score: opening.weight,
    ending_score: closing.weight,
    context_score: context,
    needs_review: review,
  };
}

function rankPromos(files, rawRules) {
  const compile = (rows) => rows.map(([label, weight, pattern]) => [label, weight, new RegExp(pattern, "i")]);
  const rules = {
    hooks: compile(rawRules.HOOKS), ending: compile(rawRules.ENDING),
    closure: new RegExp(rawRules.CLOSURE, "i"),
    stakes: new RegExp(rawRules.STAKES, "gi"),
    dependent: new RegExp(rawRules.DEPENDENT, "i"),
  };
  const coverage = [];
  const promos = [];
  const seen = new Set();
  for (const file of [...files].sort((a, b) => compare([a.name], [b.name]))) {
    const match = /^episode-(\d+)(?=[-.])[^/\\]*\.txt$/.exec(file.name);
    if (!match) throw new Error(`${file.name} is missing a numeric episode prefix`);
    const episode = Number(match[1]);
    if (seen.has(episode)) throw new Error("Multiple scripts share an episode number");
    seen.add(episode);
    const beats = parse(file);
    const result = select(beats, rules);
    coverage.push({ episode, parsed_beats: beats.length, candidate: result !== null });
    if (result) {
      result.episode = result.segments[0].episode = episode;
      promos.push(result);
    }
  }
  promos.sort((a, b) => a.needs_review - b.needs_review || b.score - a.score || a.episode - b.episode);
  promos.forEach((promo, index) => { promo.rank = index + 1; });
  return { episodes_scanned: files.length, coverage, promos };
}
