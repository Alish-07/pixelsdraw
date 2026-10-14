export const CANVAS_SIZES = [16, 24, 32, 48, 64];

export function normalizeJoinCode(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 6);
}

export function isValidJoinCode(value) {
  return normalizeJoinCode(value).length === 6;
}

export function normalizeNickname(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
}

export function participantKey(name) {
  return name.trim().toLowerCase();
}

export function validateSubmission(event, name, title, artwork) {
  if (event.phase !== "submissions") return "Submissions are closed.";
  if (!name.trim() || !title.trim()) return "Enter a participant name and artwork title.";
  if (event.entries.some((entry) => participantKey(entry.artist) === participantKey(name))) {
    return "This participant already has an entry in this event.";
  }
  if (artwork.size !== event.size) return `This event requires a ${event.size} × ${event.size} canvas.`;
  if (artwork.pixels.every((color) => color.toLowerCase() === "#ffffff")) {
    return "Draw something before submitting.";
  }
  return "";
}

export function validateBallot(event, voter, choices) {
  if (event.phase !== "voting") return "Voting is closed.";
  if (!voter.trim()) return "Enter a voter name.";
  if (!choices.length || choices.length > 3) return "Choose between one and three entries.";
  if (new Set(choices).size !== choices.length) return "Each choice must be a different entry.";
  for (const id of choices) {
    const entry = event.entries.find((item) => item.id === id);
    if (!entry) return "An entry in this ballot is missing.";
    if (participantKey(entry.artist) === participantKey(voter)) return "You cannot vote for your own artwork.";
  }
  return "";
}

export function leaderboard(event) {
  const scores = new Map(event.entries.map((entry) => [entry.id, 0]));
  for (const ballot of event.ballots) {
    ballot.choices.forEach((id, index) => {
      scores.set(id, (scores.get(id) || 0) + 3 - index);
    });
  }
  const sorted = event.entries.map((entry) => ({ ...entry, score: scores.get(entry.id) }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  // Equal scores share a rank, e.g. 1, 1, 3.
  return sorted.map((entry, index) => ({
    ...entry,
    rank: sorted.findIndex((other) => other.score === entry.score) + 1,
  }));
}

export function isValidEvent(event) {
  if (!event || typeof event.title !== "string" || typeof event.theme !== "string" ||
      !CANVAS_SIZES.includes(event.size) ||
      !["lobby", "submissions", "voting", "results"].includes(event.phase) ||
      !Array.isArray(event.entries) || !Array.isArray(event.ballots)) return false;
  const validEntries = event.entries.every((entry) =>
    entry && typeof entry.id === "string" && typeof entry.artist === "string" &&
    typeof entry.title === "string" && Array.isArray(entry.pixels) &&
    entry.pixels.length === event.size * event.size &&
    entry.pixels.every((color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)));
  if (!validEntries || new Set(event.entries.map((entry) => entry.id)).size !== event.entries.length) return false;
  return event.ballots.every((ballot) =>
    ballot && typeof ballot.voter === "string" && Array.isArray(ballot.choices) &&
    !validateBallot({ ...event, phase: "voting" }, ballot.voter, ballot.choices));
}
