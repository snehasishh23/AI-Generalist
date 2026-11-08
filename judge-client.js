function waitForJudgeRetry(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("AI review stopped", "AbortError"));
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("AI review stopped", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function requestJudgeBatch(candidates, signal, onRetry) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({ candidates }),
      });
    } catch (error) {
      if (signal.aborted || error.name === "AbortError") throw error;
      if (attempt === 2) throw new Error("The AI service could not be reached. Use the review button to retry.");
      onRetry(attempt + 1);
      await waitForJudgeRetry(2000 * (attempt + 1), signal);
      continue;
    }
    const data = await response.json().catch(() => null);
    if (response.ok && data) return data;
    const upstream = data?.upstream_status;
    const temporaryFailure = [500, 502, 503, 504].includes(response.status) &&
      (upstream == null || [500, 502, 503, 504].includes(upstream));
    if (temporaryFailure && attempt < 2) {
      onRetry(attempt + 1);
      await waitForJudgeRetry(2000 * (attempt + 1), signal);
      continue;
    }
    const dailyLimit = data?.quota_limits?.some((limit) => limit.includes("PerDay"));
    throw new Error(dailyLimit
      ? "Gemini daily quota reached. Retry after the provider resets it."
      : data?.error || "The AI service could not be reached. Use the review button to retry.");
  }
}
