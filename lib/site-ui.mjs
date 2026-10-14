export function challengeCountdown(deadline, now) {
  if (!now) return "…";
  const end = Date.parse(deadline);
  if (!Number.isFinite(end)) return "Updating…";
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  if (!seconds) return "Closing…";
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function friendlyAuthError(error, fallback = "Sign-in is unavailable right now. Please try again.") {
  if (error?.status === 429 || /rate limit|too many requests/i.test(error?.message || "")) {
    return "Please wait before requesting another link, or continue with Google.";
  }
  if (/invalid.*email|email.*invalid/i.test(error?.message || "")) return "Enter a valid email address.";
  return fallback;
}

export function phaseLabel(phase) {
  return { lobby: "Waiting for players", submissions: "Drawing", voting: "Voting", results: "Finished" }[phase] || "Competition";
}

export function savedFrameRate(value) {
  return [2, 4, 6, 8, 12, 16, 24].includes(value) ? value : 6;
}
