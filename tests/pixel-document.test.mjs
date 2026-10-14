import test from "node:test";
import assert from "node:assert/strict";
import {
  brushIndices, compositeRgba, fillArea, flattenFrame,
  copyPixels, ellipseIndices, lineIndices, movePixels, pastePixels, rectangleIndices,
  resizePixels, selectionContains, selectionFromIndices,
} from "../lib/pixel-document.mjs";

test("resizing preserves the top-left artwork", () => {
  assert.deepEqual(resizePixels(["#111111", "#222222", "#333333", "#444444"], 2, 2, 3, 2),
    ["#111111", "#222222", null, "#333333", "#444444", null]);
});

test("visible layer opacity is composited for export", () => {
  const frame = { layers: [
    { visible: true, opacity: 1, pixels: ["#ffffff"] },
    { visible: true, opacity: 0.5, pixels: ["#000000"] },
  ] };
  assert.deepEqual(compositeRgba(frame.layers, 0), [128, 128, 128, 1]);
  assert.deepEqual(flattenFrame(frame), ["#808080"]);
});

test("brush sizes and mirrors stay inside a rectangular canvas", () => {
  assert.deepEqual(brushIndices(0, 4, 3, 2), [0, 1, 4, 5]);
  assert.deepEqual(brushIndices(0, 4, 3, 1, true, true).sort((a, b) => a - b), [0, 3, 8, 11]);
});

test("line, rectangle, and fill helpers produce pixel indices", () => {
  assert.deepEqual(lineIndices(0, 8, 3), [0, 4, 8]);
  assert.deepEqual(rectangleIndices(0, 8, 3).sort((a, b) => a - b), [0, 1, 2, 3, 5, 6, 7, 8]);
  assert.deepEqual(ellipseIndices(0, 8, 3).sort((a, b) => a - b), [1, 3, 5, 7]);
  assert.deepEqual(fillArea([null, null, "#000000", null], 0, "#ff0000", 2, 2),
    ["#ff0000", "#ff0000", "#000000", "#ff0000"]);
});

test("selection helpers work on rectangular canvases and clamp moves", () => {
  const selection = selectionFromIndices(6, 11, 5);
  assert.deepEqual(selection, { x: 1, y: 1, width: 1, height: 2 });
  assert.equal(selectionContains(selection, 6, 5), true);
  assert.equal(selectionContains(selection, 7, 5), false);
  const source = ["a", "b", "c", null, null, null];
  const block = copyPixels(source, { x: 0, y: 0, width: 2, height: 1 }, 3);
  assert.deepEqual(block, { width: 2, height: 1, pixels: ["a", "b"] });
  assert.deepEqual(movePixels(source, { x: 0, y: 0, width: 2, height: 1 }, 9, 1, 3, 2), {
    pixels: [null, null, "c", null, "a", "b"], selection: { x: 1, y: 1, width: 2, height: 1 },
  });
  assert.deepEqual(pastePixels(Array(6).fill(null), block, -3, 0, 3, 2).pixels, ["a", "b", null, null, null, null]);
});
