import test from "node:test";
import assert from "node:assert/strict";
import { allowsCanvas, artworkTitle, canvasRules, describeCanvas, fieldInputState, fieldSuggestion, nicknameSuggestion, parseTimer, roomCategory, settingsFromForm, suggestedValue, timerText, validateCompetitionArtwork, votingDuration } from "../lib/competition-rules.mjs";

test("profile nickname fills the actual input, including late auth, without overwriting edits", () => {
  assert.equal(fieldInputState("", "Pixel Fox").value, "");
  assert.deepEqual(fieldInputState("Xenon", "Pixel Fox"), { value: "Xenon", fallback: "Xenon", automatic: true });
  assert.equal(fieldInputState("New profile name", "Pixel Fox", "My room name").value, "My room name");
  assert.equal(fieldInputState("Xenon", "Pixel Fox", "").value, "");
  assert.equal(fieldInputState("Xenon", "Pixel Fox", "My room name").automatic, false);
  assert.equal(fieldInputState("Xenon", "Pixel Fox", "  ").automatic, true);
  const data = new FormData(); data.set("nickname", fieldInputState("Xenon", "Pixel Fox").value);
  assert.equal(suggestedValue(data, "nickname"), "Xenon");
});

test("arbitrary exact/list/range sizes are distinct and squares stay bounded", () => {
  const list = { mode: "list", sizes: [37, 91] };
  assert.ok(allowsCanvas(list, 37, 37)); assert.ok(allowsCanvas(list, 91, 91));
  assert.equal(allowsCanvas(list, 64, 64), false);
  const range = { mode: "range", min: 23, max: 150 };
  for (const size of [23, 37, 91, 150]) assert.ok(allowsCanvas(range, size, size));
  for (const [w, h] of [[22, 22], [151, 151], [32, 64], [32.5, 32.5], [0, 0], [1025, 1025]]) assert.equal(allowsCanvas(range, w, h), false);
  assert.ok(allowsCanvas({ mode: "range", min: 1, max: 1024 }, 1000, 1000));
  assert.equal(describeCanvas({ size: 37 }), "37 × 37"); assert.deepEqual(canvasRules({ size: 37 }).sizes, [37]);
});
test("manual timers retain exact seconds and reject ambiguous/invalid input", () => {
  assert.equal(parseTimer("10:30"), 630); assert.equal(parseTimer("00:01"), 1); assert.equal(parseTimer("1440:00"), 86400); assert.equal(parseTimer(""), null);
  for (const value of ["10:60", "10.5", "-1:00", "0:00", "1440:01", "10:3"]) assert.throws(() => parseTimer(value));
  assert.equal(timerText(630), "10:30");
});
test("voting defaults to five minutes and must have a finite positive limit", () => {
  assert.equal(votingDuration(null), 300); assert.equal(votingDuration(" "), 300);
  assert.equal(votingDuration("10:30"), 630); assert.equal(votingDuration("1440:00"), 86400);
  for (const value of ["0:00", "5", "-1:00", "5:60", "1440:01"]) assert.throws(() => votingDuration(value));
});
test("form settings support manual voting shares and keep/off timer semantics", () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ canvasMode: "list", allowedSizes: "91, 37, 37", animation: "required", showPoints: "on", hostVotePercent: "37", duration: "10:30" })) data.set(key, value);
  const parsed = settingsFromForm(data);
  assert.equal(parsed.p_host_vote_percent, 37); assert.equal(parsed.p_duration_seconds, 630); assert.deepEqual(parsed.p_rules.sizes, [37, 91]);
  assert.equal(parsed.p_voting_duration_seconds, 300);
  data.set("votingDuration", "7:30"); assert.equal(settingsFromForm(data).p_voting_duration_seconds, 450);
  data.set("timerAction", "keep"); assert.equal(settingsFromForm(data, {}).p_duration_seconds, null);
  data.set("timerAction", "change"); data.set("duration", ""); assert.equal(settingsFromForm(data, {}).p_duration_seconds, 0);
  data.set("hostVotePercent", "101"); assert.throws(() => settingsFromForm(data));
});
test("animation, dimensions, pixels, blank work and limits are validated", () => {
  const event = { size: 2, animation_mode: "required" };
  const frame = ["#000000", "#ffffff", "#ffffff", "#ffffff"];
  const art = { size: 2, height: 2, frames: [frame, frame], fps: 6 };
  assert.equal(validateCompetitionArtwork(event, art), "");
  assert.match(validateCompetitionArtwork(event, { ...art, frames: [frame] }), /at least two/);
  assert.match(validateCompetitionArtwork({ ...event, animation_mode: "disabled" }, art), /disabled/);
  assert.match(validateCompetitionArtwork(event, { ...art, height: 3 }), /Canvas/);
  assert.match(validateCompetitionArtwork(event, { ...art, frames: [frame, ["red"]] }), /Invalid/);
  assert.match(validateCompetitionArtwork(event, { ...art, frames: Array(33).fill(frame) }), /32 frames/);
  assert.match(validateCompetitionArtwork(event, { ...art, fps: 25 }), /FPS/);
  assert.match(validateCompetitionArtwork(event, { ...art, frames: Array(2).fill(Array(4).fill("#ffffff")) }), /Draw something/);
});
test("current excludes finished/week-old rooms; deleted rooms remain recoverable", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const room = { phase: "lobby", created_at: "2026-10-07T00:00:00Z" };
  assert.equal(roomCategory(room, now), "current");
  assert.equal(roomCategory({ ...room, phase: "results" }, now), "past");
  assert.equal(roomCategory({ ...room, created_at: "2026-09-29T00:00:00Z" }, now), "past");
  assert.equal(roomCategory({ ...room, deleted_at: room.created_at }, now), "trash");
});
test("nickname placeholders have multiple random combinations", () => {
  assert.equal(nicknameSuggestion(() => 0), "Pixel Panda");
  assert.notEqual(nicknameSuggestion(() => 0), nicknameSuggestion(() => .99));
});
test("competition/theme suggestions can change and blank fields accept suggestions", () => {
  for (const kind of ["nickname", "competition", "theme"]) {
    const first = fieldSuggestion(kind, () => 0);
    assert.ok(first.length > 0);
    assert.notEqual(first, fieldSuggestion(kind, () => 0, first));
  }
  const data = new FormData(); data.set("nicknameSuggestion", "Pixel Fox");
  assert.equal(suggestedValue(data, "nickname"), "Pixel Fox");
  data.set("nickname", "  My Name  "); assert.equal(suggestedValue(data, "nickname"), "My Name");
  for (const [name, fallback] of [["nickname", "Pixel Fox"], ["title", "Color Quest"], ["theme", "Tiny worlds"]]) {
    data.set(name, "   "); data.set(`${name}Suggestion`, fallback);
    assert.equal(suggestedValue(data, name), fallback);
    data.set(name, "  My choice  "); assert.equal(suggestedValue(data, name), "My choice");
  }
  assert.equal(artworkTitle("  "), "Untitled"); assert.equal(artworkTitle("  Sprite  "), "Sprite");
});
