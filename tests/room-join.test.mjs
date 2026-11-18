import test from "node:test";
import assert from "node:assert/strict";
import { roomWithJoinReceipt } from "../lib/room-join.mjs";

const lobby = { id: "room-a", phase: "lobby", my_admission: null, entries: [] };
const receipt = { roomId: "room-a", userId: "guest-a", nickname: "Sprite", admission: "admitted" };

test("a server join receipt renders membership immediately without mutating the snapshot", () => {
  const joined = roomWithJoinReceipt(lobby, "guest-a", receipt);
  assert.equal(joined.my_nickname, "Sprite");
  assert.equal(joined.my_admission, "admitted");
  assert.equal(lobby.my_admission, null);
  assert.equal(joined.entries, lobby.entries);
});

test("pending audience admission never turns into admitted access", () => {
  const voting = { ...lobby, phase: "voting" };
  const pending = roomWithJoinReceipt(voting, "guest-a", { ...receipt, admission: "pending" });
  assert.equal(pending.my_admission, "pending");
  assert.equal(pending.phase, "voting");
  const rejected = { ...pending, my_admission: "rejected" };
  assert.equal(roomWithJoinReceipt(rejected, "guest-a", receipt), rejected);
});

test("receipts never cross room or account boundaries or replace a missing snapshot", () => {
  for (const userId of [undefined, "guest-b"]) assert.equal(roomWithJoinReceipt(lobby, userId, receipt), lobby);
  const otherRoom = { ...lobby, id: "room-b" };
  assert.equal(roomWithJoinReceipt(otherRoom, "guest-a", receipt), otherRoom);
  assert.equal(roomWithJoinReceipt(null, "guest-a", receipt), null);
  assert.equal(roomWithJoinReceipt(lobby, "guest-a", { ...receipt, admission: undefined }), lobby);
});
