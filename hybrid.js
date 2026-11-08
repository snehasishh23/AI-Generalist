function combineJudgments(baseline, reviews, batches = []) {
  const judgments = new Map(reviews.map((review) => [review.id, review]));
  const chosen = new Map();
  for (const candidate of baseline.candidates) {
    const review = judgments.get(candidate.id);
    const ruleScore = Math.max(0, Math.min(100, candidate.score / 44 * 100));
    const aiScore = review
      ? 10 * (0.4 * review.hook_score + 0.4 * review.cliffhanger_score + 0.2 * review.clarity_score)
      : null;
    const combined = review ? Number((0.75 * aiScore + 0.25 * ruleScore).toFixed(2)) : null;
    const promo = {
      ...candidate,
      rule_rank: baseline.promos.find((item) => item.episode === candidate.episode)?.rank,
      judgment_source: review ? "rules_and_gemini" : "rules_only",
      ai_review: review || null,
      combined_score: combined,
    };
    if (review) {
      const hookBeat = candidate.clip_beats[review.hook_beat];
      const endingBeat = candidate.clip_beats[review.ending_beat];
      promo.hook = { ...candidate.hook, ai_assessment: review.hook };
      promo.cliffhanger = { ...candidate.cliffhanger, ai_assessment: review.cliffhanger };
      if (review.hook_evidence_valid) {
        promo.hook = { start: hookBeat.start, end: hookBeat.end, speaker: hookBeat.speaker,
          script_evidence: hookBeat.text, ai_assessment: review.hook };
      }
      if (review.ending_evidence_valid) {
        promo.cliffhanger = { start: endingBeat.start, end: endingBeat.end, speaker: endingBeat.speaker,
          script_evidence: endingBeat.text, ai_assessment: review.cliffhanger };
      }
      promo.why_it_works = review.why_it_works;
      promo.needs_review = review.hook_score < 6 || review.cliffhanger_score < 6 ||
        review.clarity_score < 6 || !review.hook_evidence_valid || !review.ending_evidence_valid;
      promo.posting_rationale = "Combined " + combined + "/100. Gemini hook " + review.hook_score +
        "/10, cliffhanger " + review.cliffhanger_score + "/10, clarity " + review.clarity_score +
        "/10. Rule score " + candidate.score + ".";
    }
    const current = chosen.get(candidate.episode);
    const better = !current || (Boolean(review) > Boolean(current.ai_review)) ||
      (Boolean(review) === Boolean(current.ai_review) &&
        (review ? combined > current.combined_score : candidate.score > current.score));
    if (better) chosen.set(candidate.episode, promo);
  }
  const promos = [...chosen.values()].sort((a, b) =>
    Boolean(b.ai_review) - Boolean(a.ai_review) ||
    Number(a.needs_review) - Number(b.needs_review) ||
    (b.combined_score ?? b.score) - (a.combined_score ?? a.score) || a.episode - b.episode);
  promos.forEach((promo, index) => { promo.rank = index + 1; });
  const reviewed = promos.filter((promo) => promo.ai_review).length;
  return {
    ...baseline,
    promos,
    ai: {
      status: reviews.length === baseline.candidates.length ? "complete" : reviews.length ? "partial" : "not_run",
      reviewed_candidates: reviews.length,
      candidate_count: baseline.candidates.length,
      reviewed_episodes: reviewed,
      model_runs: batches,
      ranking_weights: { ai: 0.75, rules: 0.25 },
    },
    ai_judgments: reviews,
    rule_baseline: baseline.promos,
  };
}
