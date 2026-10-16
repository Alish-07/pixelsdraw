// Competition rules are checked here for helpful messages and again in SQL.
export const COMPETITION_MAX_SIDE = 1024;
export function canvasRules(event) {
  return event?.canvas_rules || { mode: "fixed", sizes: [event?.size || 32], min: 1, max: 1024 };
}
export function allowsCanvas(rules, width, height) {
  if (!Number.isInteger(width) || width !== height || width < 1 || width > 1024) return false;
  return rules.mode === "range" ? width >= rules.min && width <= rules.max : rules.sizes.includes(width);
}
export function describeCanvas(event) {
  const rules = canvasRules(event);
  return rules.mode === "range" ? `Any square from ${rules.min} × ${rules.min} to ${rules.max} × ${rules.max}` : rules.sizes.map((size) => `${size} × ${size}`).join(" or ");
}
export function parseTimer(value) {
  if (!value.trim()) return null;
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(value.trim());
  const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) throw new Error("Use minutes:seconds, from 00:01 to 1440:00 (24 hours).");
  return seconds;
}
export function timerText(seconds) {
  return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "";
}
export function votingDuration(value) { return parseTimer(String(value || "")) ?? 300; }
export function settingsFromForm(data, event) {
  const mode = data.get("canvasMode");
  const sizes = String(data.get("allowedSizes") || "").split(/[,\s]+/).filter(Boolean).map(Number);
  const rules = { mode, sizes: [...new Set(sizes)].sort((a, b) => a - b), min: mode === "range" ? Number(data.get("minimum")) : 1, max: mode === "range" ? Number(data.get("maximum")) : 1024 };
  if (!["fixed", "list", "range"].includes(mode) || (mode !== "range" && (!sizes.length || sizes.length > 64 || (mode === "fixed" && sizes.length !== 1) || sizes.some((size) => !Number.isInteger(size) || size < 1 || size > 1024))) || (mode === "range" && (!Number.isInteger(rules.min) || !Number.isInteger(rules.max) || rules.min < 1 || rules.max > 1024 || rules.min > rules.max))) throw new Error("Choose valid square canvas sizes between 1 and 1024 pixels (up to 64 listed sizes).");
  const size = mode === "range" ? rules.min : rules.sizes[0];
  const percent = Number(data.get("hostVotePercent"));
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error("Host voting share must be a whole percentage from 0 to 100.");
  return { p_size: size, p_rules: rules, p_animation: data.get("animation"), p_show_points: data.get("showPoints") === "on", p_show_gallery: data.get("showGallery") === "on", p_host_vote_percent: percent, p_duration_seconds: event && data.get("timerAction") === "keep" ? null : parseTimer(String(data.get("duration") || "")) || 0, p_voting_duration_seconds: votingDuration(data.get("votingDuration")), p_show_roster: data.get("showRoster") === "on", p_admission_mode: data.get("admissionMode") || event?.admission_mode || "auto", p_allow_late_join: event ? event.allow_late_join !== false : data.get("allowLateJoin") === "on" };
}
export function validateCompetitionArtwork(event, artwork) {
  if (!allowsCanvas(canvasRules(event), artwork.size, artwork.height || artwork.size)) return `Canvas must match: ${describeCanvas(event)}.`;
  const frames = artwork.frames || [artwork.pixels];
  const mode = event.animation_mode || "disabled";
  if (!frames.length || frames.length > 32 || frames.length * artwork.size ** 2 > 4194304) return "Use up to 32 frames and 4,194,304 submitted pixels in total.";
  if (mode === "required" && frames.length < 2) return "This competition requires an animation with at least two frames.";
  if (mode === "disabled" && frames.length !== 1) return "Animation is disabled for this competition.";
  if (!Number.isInteger(artwork.fps) || artwork.fps < 1 || artwork.fps > 24) return "Animation speed must be from 1 to 24 FPS.";
  if (frames.some((frame) => !Array.isArray(frame) || frame.length !== artwork.size ** 2 || frame.some((color) => typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)))) return "Invalid frame pixels.";
  if (frames.every((frame) => frame.every((color) => color.toLowerCase() === "#ffffff"))) return "Draw something before submitting.";
  return "";
}
export function roomCategory(room, now) {
  if (room.deleted_at) return "trash";
  return room.phase === "results" || new Date(room.created_at).getTime() < now - 7 * 86400000 ? "past" : "current";
}
export function nicknameSuggestion(random = Math.random) {
  const first = ["Pixel", "Cosmic", "Doodle", "Neon", "Sprite", "Magic", "Tiny", "Sketch"];
  const last = ["Panda", "Fox", "Otter", "Dragon", "Owl", "Tiger", "Penguin", "Koala"];
  return `${first[Math.floor(random() * first.length)]} ${last[Math.floor(random() * last.length)]}`;
}
export function fieldSuggestion(kind, random = Math.random, previous = "") {
  const pools = {
    competition: ["Tiny Worlds Tournament", "Sprite Showdown", "Pixel Playground", "Color Quest", "Pocket Art Battle", "Doodle Derby", "Neon Pixel Jam", "Creative Critters"],
    theme: ["A tiny world in space", "An enchanted forest", "A robot with a secret", "Life under the ocean", "A cozy rainy day", "Your dream arcade", "A creature made of clouds", "A city after midnight"],
  };
  if (kind === "nickname") {
    const candidate = nicknameSuggestion(random);
    return candidate === previous ? `${candidate} ${Math.floor(random() * 99) + 1}` : candidate;
  }
  const options = pools[kind].filter((item) => item !== previous);
  return options[Math.floor(random() * options.length)];
}
export function suggestedValue(data, name, fallback = "") {
  return String(data.get(name) || "").trim() || String(data.get(`${name}Suggestion`) || fallback).trim();
}
export function fieldInputState(preferredName, suggestion, editedValue = null) {
  return {
    value: editedValue ?? preferredName,
    fallback: preferredName || suggestion,
    automatic: editedValue === null || !editedValue.trim(),
  };
}
export function artworkTitle(value) { return String(value || "").trim() || "Untitled"; }
