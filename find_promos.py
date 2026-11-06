"""Find continuous promo candidates in timestamped microdrama screenplays."""
import argparse
from collections import Counter
from dataclasses import dataclass
import json
from pathlib import Path
import re

STAMP = r"(\d+:\d{2}\.\d{2})"
BLOCK = re.compile(
    rf"^\*\*(.+?):\*\*[ \t]*\nStart: \({STAMP}\) \| End: \({STAMP}\)[ \t]*\n"
    r"(.*?)(?=^\*\*|^SCENE\s+\d|^--- SCRIPT END ---|\Z)",
    re.MULTILINE | re.DOTALL,
)


def rules(*specifications):
    return [(label, weight, re.compile(pattern, re.I))
            for label, weight, pattern in specifications]


HOOKS = rules(
    ("physical confrontation", 6, r"\b(slap(?:s|ped)?|lunges?|stabs?|strikes?|punch(?:es)?|tackles?|backhands?)\b"),
    ("immediate danger", 5, r"\b(screams?|poison(?:ed)?|gunshot|blood-soaked|blade|dagger|execution|kill(?:ed)?)\b"),
    ("betrayal or accusation", 5, r"\b(traitor|bastard|betray(?:ed|al)?|fraud|impostor|you lied|adulter\w*|murderer)\b"),
    ("identity or relationship reveal", 5, r"\b(?:i am|i'm|you are|you're|he is|he's|she is|she's) (?:really |actually )?(?:the |a |my |your )(?:real |true )?(?:duke|heir|husband|wife|father|mother|daughter|son|sister|brother)\b"),
    ("coercion", 4, r"\b(?:you have no choice|on your knees|seize (?:him|her)|strip (?:him|her) of|sentence (?:him|her) to)\b"),
    ("direct defiance or demand", 3, r"\b(how dare you|get out|let (?:him|her|me) go|stop right there|i refuse|i demand|arrest (?:him|her))\b"),
    ("visible distress", 2, r"\b(gasps?|collapses?|sobbing|shatters?|bursts? (?:in|open))\b"),
)
ENDING = rules(
    ("imminent action", 6, r"\b(about to|poised to|raises? (?:his|her|the) (?:hand|blade|sword|dagger)|lunges?|before (?:he|she|they) can|cut off mid)\b"),
    ("forced removal", 5, r"\b(?:drags?|hauls?|marches?) (?:him|her|them|\w+) (?:away|out|back|towards?)\b"),
    ("threat or vow", 5, r"\b(you will pay|you'll pay|you will regret|i will (?:kill|destroy|expose|find|make)|i'll (?:kill|destroy|expose|find|make)|vengeance|dead by|mark my words)\b"),
    ("new information", 4, r"\b(reveal(?:s|ed)?|real(?:ly)? (?:duke|heir)|the truth|secret|you lied|you are the|you're the|traitor|poisoned)\b"),
    ("direct question", 3, r"\?\s*[”\"']?\s*$"),
    ("unresolved reaction", 2, r"\b(stunned|horrified|frozen|eyes widen|gasps?|tense silence|shocked)\b"),
)
CLOSURE = re.compile(r"\b(smiles? warmly|relief washes|problem solved|forgive you|all is well|reassur\w*)\b", re.I)
STAKES = re.compile(r"\b(marry|marriage|wedding|husband|wife|family|trial|arrest|duke|heir|inheritance|kill|poison|betray\w*)\b", re.I)
DEPENDENT = re.compile(r"^(?:[“\"])?(?:and|but|so|then|yes|no|because|as i said)\b", re.I)


@dataclass(frozen=True)
class Beat:
    start: int
    end: int
    speaker: str
    text: str

    @property
    def dialogue(self):
        return self.speaker not in {"CAMERA", "ACTION", "SOUND FX", "MUSIC", "TEXT OVERLAY"}


def ticks(stamp):
    minutes, seconds = stamp.split(":")
    return int(minutes) * 6000 + int(seconds.replace(".", ""))


def timecode(value):
    minutes, remaining = divmod(value, 6000)
    seconds, hundredths = divmod(remaining, 100)
    return f"{minutes:02}:{seconds:02}.{hundredths:02}"


def parse(path):
    script = path.read_text(encoding="utf-8-sig")
    section = script.split("--- SCRIPT START ---", 1)[-1].split("--- SCRIPT END ---", 1)[0]
    beats = [Beat(ticks(start), ticks(end), tag.strip(), " ".join(body.split()))
             for tag, start, end, body in BLOCK.findall(section)]
    if not beats or len(beats) != len(re.findall(r"^Start:", section, re.M)):
        raise ValueError(f"{path.name} contains missing or unrecognized timestamp blocks")
    if any(beat.start >= beat.end or not beat.text for beat in beats):
        raise ValueError(f"{path.name} contains an empty or invalid beat")
    return sorted(beats, key=lambda beat: (beat.start, beat.end))


class RuleScorer:
    """Replace hook, ending and context methods to plug in another scorer."""

    def hook(self, beat):
        matches = [(weight, label) for label, weight, pattern in HOOKS if pattern.search(beat.text)]
        weight, label = max(matches, default=(0, "opening beat"))
        if beat.speaker == "CAMERA":
            weight = max(0, weight - 2)
        if label == "physical confrontation" and re.search(r"\bgavel\b", beat.text, re.I):
            weight, label = 0, "opening beat"
        if beat.dialogue and DEPENDENT.search(beat.text):
            weight = max(0, weight - 1)
        return weight, label

    def ending(self, beat):
        matches = [(weight, label) for label, weight, pattern in ENDING if pattern.search(beat.text)]
        weight, label = max(matches, default=(0, "closing beat"))
        if CLOSURE.search(beat.text):
            weight -= 2
        if beat.speaker == "CAMERA":
            weight -= 1
        return weight, label

    def context(self, dialogue):
        # Repeated stakes words count once. Speech alone is a weak context proxy.
        stakes = {word.lower() for beat in dialogue for word in STAKES.findall(beat.text)}
        return min(3, len(stakes)) + (len(dialogue) >= 3)


def cuts_speech(dialogue, point):
    return any(beat.start < point < beat.end for beat in dialogue)


def evidence(beat, label):
    return {"cue": label, "start": timecode(beat.start), "end": timecode(beat.end),
            "speaker": beat.speaker, "script_evidence": beat.text}


def select(beats, scorer):
    dialogue = [beat for beat in beats if beat.dialogue]
    story = [beat for beat in beats if beat.speaker not in {"SOUND FX", "MUSIC", "TEXT OVERLAY"}]
    hooks = [(beat, *scorer.hook(beat)) for beat in story]
    endings = [(beat, *scorer.ending(beat)) for beat in story]
    duration = max(beat.end for beat in beats)
    starts = sorted({0} | {beat.start for beat in story if not cuts_speech(dialogue, beat.start)})
    ends = sorted({beat.end for beat in story if not cuts_speech(dialogue, beat.end)})
    best = None
    for start in starts:
        opening = [(weight, -beat.start, label, index)
                   for index, (beat, weight, label) in enumerate(hooks)
                   if start <= beat.start < start + 300]
        if not opening:
            continue
        hook_score, _, hook_label, hook_index = max(opening)
        for end in ends:
            length = end - start
            if not 2000 <= length <= 6000:
                continue
            closing = [(weight, beat.end, label, index)
                       for index, (beat, weight, label) in enumerate(endings)
                       if end - 220 <= beat.end <= end and beat.start >= start]
            if not closing:
                continue
            end_score, _, end_label, end_index = max(closing)
            lines = [beat for beat in dialogue if start <= beat.start and beat.end <= end]
            context = scorer.context(lines)
            hook_beat = hooks[hook_index][0]
            end_beat = endings[end_index][0]
            score = (3 * hook_score + 3 * end_score + 2 * context
                     + int(end == duration) - abs(length - 3400) / 1000
                     - (hook_beat.start - start + end - end_beat.end) / 250)
            key = (score, hook_score, end_score, -start, -end)
            if best is None or key > best[0]:
                best = (key, end, hook_beat, hook_label, end_beat, end_label, context)
    if best is None:
        return None
    (score, hook_score, end_score, negative_start, _), end, hook, h_label, ending, e_label, context = best
    start = -negative_start
    review = hook_score < 4 or end_score < 4 or context < 2
    reason = (f"Opens with {h_label} and cuts on {e_label}."
              if not review else f"Review the {h_label} opener and {e_label} ending for editorial fit.")
    return {
        "segments": [{"start": timecode(start), "end": timecode(end)}],
        "duration_seconds": (end - start) / 100,
        "hook": evidence(hook, h_label), "cliffhanger": evidence(ending, e_label),
        "why_it_works": reason,
        "posting_rationale": (
            f"Hook {hook_score}/6, ending {end_score}/6, standalone-context proxy {context}/4."
        ),
        "score": round(score, 3),
        "hook_score": hook_score,
        "ending_score": end_score,
        "context_score": context,
        "needs_review": review,
    }


def run(folder, scorer):
    files = sorted(path for path in folder.glob("episode-*.txt") if path.is_file())
    if not files:
        raise ValueError("Expected episode-*.txt screenplays in the input folder")
    promos, coverage = [], []
    for path in files:
        match = re.match(r"episode-(\d+)(?=[-.])", path.name)
        if not match:
            raise ValueError(f"{path.name} is missing a numeric episode prefix")
        episode = int(match[1])
        beats = parse(path)
        result = select(beats, scorer)
        coverage.append({"episode": episode, "parsed_beats": len(beats), "candidate": result is not None})
        if result:
            result.update(episode=episode)
            result["segments"][0]["episode"] = episode
            promos.append(result)
    if max(Counter(row["episode"] for row in coverage).values()) > 1:
        raise ValueError("Multiple scripts share an episode number")
    promos.sort(key=lambda item: (item["needs_review"], -item["score"], item["episode"]))
    for rank, promo in enumerate(promos, 1):
        promo["rank"] = rank
    return {"episodes_scanned": len(files), "coverage": coverage, "promos": promos}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--out", type=Path, default=Path("raw_outputs/promos.json"))
    args = parser.parse_args()
    try:
        results = run(args.input, RuleScorer())
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(f"Scanned {results['episodes_scanned']} episodes. Wrote {len(results['promos'])} candidates to {args.out}")


if __name__ == "__main__":
    main()
