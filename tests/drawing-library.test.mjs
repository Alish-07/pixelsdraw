import test from "node:test";
import assert from "node:assert/strict";
import { drawingKey, drawingName, libraryOwner, planDrawingSave, setDrawingTrashed } from "../lib/drawing-library.mjs";
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

test("repeated saves require confirmation, including case and spacing variants", () => {
  const document = { artworkTitle: "Pixel Panda", width: 16, height: 16 };
  const first = planDrawingSave([], document, { newId: "first" });
  assert.equal(first.status, "saved");
  for (const title of ["Pixel Panda", " pixel panda ", "PIXEL   PANDA", "Ｐixel Panda"]) {
    const next = planDrawingSave(first.entries, { ...document, artworkTitle: title }, { newId: "second" });
    assert.equal(next.status, "conflict");
    assert.equal(next.existing.id, "first");
  }
  assert.equal(drawingName(""), "");
  assert.equal(planDrawingSave([], { ...document, artworkTitle: " " }, { newId: "blank" }).entry.title, "Untitled artwork");
});

test("confirmed replacement keeps its ID and leaves unrelated drawings alone", () => {
  const entries = Object.freeze([Object.freeze({ id: "one", title: "Panda" }), Object.freeze({ id: "two", title: "Moon" })]);
  const result = planDrawingSave(entries, { artworkTitle: "Panda", width: 32, height: 24 }, { newId: "unused", replaceId: "one" });
  assert.equal(result.status, "saved");
  assert.equal(result.entry.id, "one");
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[1], entries[1]);
  assert.equal(entries[0].width, undefined);
  assert.equal(planDrawingSave(entries, { artworkTitle: "Panda" }, { newId: "bad", replaceId: "two" }).status, "conflict");
  const renamed = planDrawingSave(entries, { artworkTitle: "Panda copy" }, { newId: "three" });
  assert.equal(renamed.entries.length, 3);
  assert.equal(renamed.entry.id, "three");
});

test("trash and restore are non-destructive, and trashed names can be reused", () => {
  const entries = [{ id: "one", title: "Panda" }, { id: "two", title: "Moon" }];
  const trashed = setDrawingTrashed(entries, "one", true);
  assert.ok(trashed[0].deletedAt);
  assert.equal(trashed[1], entries[1]);
  assert.equal(entries[0].deletedAt, undefined);
  const copy = planDrawingSave(trashed, { artworkTitle: "Panda" }, { newId: "three" });
  assert.equal(copy.status, "saved");
  assert.equal(copy.entries.length, 3);
  assert.ok(copy.entries.find(entry => entry.id === "one").deletedAt);
  assert.equal(setDrawingTrashed(trashed, "one", false)[0].deletedAt, null);
  assert.throws(() => setDrawingTrashed(entries, "someone-else", true));
});
