import test from "node:test";
import assert from "node:assert/strict";
import { challengeTiming, durationLabel } from "../lib/public-challenge-ui.mjs";

function round(drawing, voting, key = "daily") {
  const start = Date.parse("2026-10-15T00:00:00Z");
  return { challenge_key: key, round_start: new Date(start).toISOString(), submission_deadline: new Date(start + drawing * 1000).toISOString(), next_round_at: new Date(start + (drawing + voting) * 1000).toISOString() };
}
test("challenge labels reflect actual six-hour, sprint and historical round clocks", () => {
  assert.deepEqual(challengeTiming(round(21600, 1800)), { drawing: "6h", voting: "30m", label: "Six-hour challenge" });
  assert.deepEqual(challengeTiming(round(900, 300, "sprint")), { drawing: "15m", voting: "5m", label: "Quick play" });
  assert.deepEqual(challengeTiming(round(82800, 3600)), { drawing: "23h", voting: "1h", label: "Daily challenge" });
  assert.equal(durationLabel(NaN), null);
  assert.equal(durationLabel(-1), null);
  assert.equal(durationLabel(23400), "6h 30m");
});
