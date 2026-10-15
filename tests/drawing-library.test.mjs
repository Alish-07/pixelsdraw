import test from "node:test";
import assert from "node:assert/strict";
import { drawingKey, libraryOwner } from "../lib/drawing-library.mjs";
import { editorDraftKeys } from "../lib/editor-lab-storage.mjs";

test("drawing libraries separate guest copies and signed-in accounts", () => {
  assert.equal(libraryOwner(null), "device");
  assert.equal(libraryOwner({ id: "guest", is_anonymous: true }), "device");
  assert.equal(libraryOwner({ id: "alice", is_anonymous: false }), "alice");
  assert.notEqual(libraryOwner({ id: "alice" }), libraryOwner({ id: "bob" }));
});

test("saved drawing keys cannot overwrite main, lab, or competition drafts", () => {
  const key = drawingKey("12ab-34cd");
  for (const draft of [editorDraftKeys(), editorDraftKeys(null, "lab"), editorDraftKeys("room")]) {
    assert.notEqual(key, draft.primary);
    assert.notEqual(key, draft.legacy);
  }
  const saved = editorDraftKeys(null, "drawing:12ab-34cd");
  assert.equal(saved.primary, key);
  assert.equal(saved.legacy, key);
  assert.equal(saved.labFallback, null);
  for (const id of ["", "../main", "a:b", "x".repeat(81)]) assert.throws(() => drawingKey(id));
});
