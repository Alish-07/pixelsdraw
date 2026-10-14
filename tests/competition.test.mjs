import test from "node:test";
import assert from "node:assert/strict";
import { validateSubmission, validateBallot, leaderboard, isValidEvent, normalizeJoinCode, isValidJoinCode, normalizeNickname } from "../lib/competition.mjs";

const event = {
  title: "Club event", theme: "Space", size: 16, phase: "voting",
  entries: ["A", "B", "C"].map((id) => ({ id, title: id, artist: id, pixels: Array(256).fill("#7c3aed") })),
  ballots: [],
};

test("ballots reject self-votes, repeated entries, unknown entries and closed voting", () => {
  assert.match(validateBallot(event, " a ", ["A"]), /own artwork/);
  assert.match(validateBallot(event, "judge", ["A", "A"]), /different/);
  assert.match(validateBallot(event, "judge", ["missing"]), /missing/);
  assert.match(validateBallot({ ...event, phase: "results" }, "judge", ["A"]), /closed/);
  assert.equal(validateBallot(event, "judge", ["A", "B", "C"]), "");
});

test("3–2–1 scores produce shared ranks for ties", () => {
  const results = leaderboard({ ...event, ballots: [
    { voter: "judge1", choices: ["A", "B", "C"] },
    { voter: "judge2", choices: ["B", "A", "C"] },
  ] });
  assert.deepEqual(results.map(({ score, rank }) => [score, rank]), [[5, 1], [5, 1], [2, 3]]);
});

test("submissions enforce phase, size, nonblank art and one entry per normalized name", () => {
  const open = { ...event, phase: "submissions" };
  const art = { size: 16, pixels: Array(256).fill("#7c3aed") };
  assert.match(validateSubmission(event, "new", "art", art), /closed/);
  assert.match(validateSubmission(open, " a ", "art", art), /already/);
  assert.match(validateSubmission(open, "new", "art", { ...art, size: 32 }), /requires/);
  assert.match(validateSubmission(open, "new", "art", { ...art, pixels: Array(256).fill("#ffffff") }), /Draw/);
  assert.equal(validateSubmission(open, "new", "art", art), "");
});

test("restored events reject corrupt artwork and invalid ballots", () => {
  assert.equal(isValidEvent(event), true);
  assert.equal(isValidEvent({ ...event, entries: [{ ...event.entries[0], pixels: [] }] }), false);
  assert.equal(isValidEvent({ ...event, ballots: [{ voter: "A", choices: ["A"] }] }), false);
});

test("join codes accept six digits and ignore spaces or dashes", () => {
  assert.equal(normalizeJoinCode(" 123-456 "), "123456");
  assert.equal(normalizeJoinCode("room 987654321"), "987654");
  assert.equal(isValidJoinCode("123 456"), true);
  assert.equal(isValidJoinCode("12345"), false);
});

test("nicknames are trimmed, compacted and length-limited", () => {
  assert.equal(normalizeNickname("  Pixel   Panda  "), "Pixel Panda");
  assert.equal(normalizeNickname("x".repeat(70)).length, 60);
});

test("waiting-lobby events are valid but cannot accept artwork yet", () => {
  const waiting = { ...event, phase: "lobby" };
  const art = { size: 16, pixels: Array(256).fill("#7c3aed") };
  assert.equal(isValidEvent(waiting), true);
  assert.match(validateSubmission(waiting, "new", "art", art), /closed/);
});
