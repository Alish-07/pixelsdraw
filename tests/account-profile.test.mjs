import test from "node:test";
import assert from "node:assert/strict";
import { accountProfile, draftOwner } from "../lib/account-profile.mjs";
import { editorDraftKeys } from "../lib/editor-lab-storage.mjs";
import { readFileSync } from "node:fs";

test("Google names and email are never automatically public", () => {
  assert.equal(accountProfile({ email: "private@example.com", user_metadata: { full_name: "Private Name" } }).displayName, "");
  assert.equal(accountProfile(null).displayName, "");
  assert.equal(accountProfile({ user_metadata: { profile_name: " Name ", profile_nickname: " Sprite " } }).displayName, "Sprite");
  assert.equal(accountProfile({ user_metadata: { profile_name: " Name ", profile_nickname: " " } }).displayName, "Name");
});

test("editors wait for auth and remount their document and room state on identity changes", () => {
  const canvas = readFileSync(new URL("../components/PixelCanvas.js", import.meta.url), "utf8");
  const rooms = readFileSync(new URL("../components/OnlineStudio.js", import.meta.url), "utf8");
  assert.match(canvas, /if \(!ready\) return/);
  assert.match(canvas, /<AccountCanvas key=\{`\$\{owner\}/);
  assert.match(canvas, /editorDraftKeys\(competition\?\.id, storageScope, owner\)/);
  assert.doesNotMatch(canvas, /OLD_STORAGE_KEY/);
  assert.match(rooms, /<AccountOnlineStudio key=\{draftOwner\(user\)\}/);
  assert.match(rooms, /competition-nickname:\$\{owner\}:/);
});

test("main, lab and room drafts isolate accounts and guest sessions without legacy imports", () => {
  const owners = [draftOwner(null), draftOwner({ id: "a" }), draftOwner({ id: "b" }), draftOwner({ id: "anon", is_anonymous: true })];
  for (const [room, scope] of [[null, "main"], [null, "lab"], ["room", "main"]]) {
    const keys = owners.map(owner => editorDraftKeys(room, scope, owner));
    assert.equal(new Set(keys.map(key => key.primary)).size, owners.length);
    for (const key of keys) {
      assert.equal(key.legacy, key.primary);
      assert.equal(key.labFallback, null);
      assert.notEqual(key.primary, editorDraftKeys(room, scope).primary);
    }
    assert.equal(editorDraftKeys(room, scope, owners[1]).primary, keys[1].primary);
  }
});
