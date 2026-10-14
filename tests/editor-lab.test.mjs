import test from "node:test";
import assert from "node:assert/strict";
import { brushFootprints, ditherAccept, invertColor, rasterBytes, reorderLayers, nextLayerName, panelWidth, placeFloating, pointerPixel, renumberLayers, transformClip, zoomScale } from "../lib/editor-lab.mjs";
import { brushIndices, compositeRgba, movePixels, pastePixels } from "../lib/pixel-document.mjs";
import { editorDraftKeys } from "../lib/editor-lab-storage.mjs";

test("promotion preserves legacy keys and isolates main, lab and each competition draft", () => {
  const main = editorDraftKeys();
  const lab = editorDraftKeys(null, "lab");
  assert.equal(main.legacy, "pixel-art-studio:draft:v2");
  assert.notEqual(main.primary, lab.primary);
  assert.equal(main.labFallback, lab.primary);
  const room = editorDraftKeys("room-a");
  assert.equal(room.legacy, "pixel-art-studio:draft:v2:competition:room-a");
  assert.equal(room.labFallback, null);
  assert.notEqual(room.primary, editorDraftKeys("room-b").primary);
  assert.notEqual(room.primary, editorDraftKeys("room-a", "lab").primary);
});

test("eraser hover boxes cover exactly the erased pixels, including even sizes, edges and mirrors", () => {
  for (const center of [0, 5, 31]) for (const size of [1, 2, 3, 32]) {
    const indices = new Set();
    for (const box of brushFootprints(center, 8, 4, size, true, true)) {
      for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) indices.add(y * 8 + x);
    }
    assert.deepEqual([...indices].sort((a,b) => a-b), brushIndices(center, 8, 4, size, true, true).sort((a,b) => a-b));
  }
});

test("cached raster renderer matches export compositing including hidden and translucent layers", () => {
  const layers = [
    { visible: true, opacity: 0.3, pixels: ["#123456", null, "#ffffff"] },
    { visible: false, opacity: 1, pixels: ["#000000", "#ffffff", null] },
    { visible: true, opacity: 0.6, pixels: ["#abcdef", "#123456", null] },
  ];
  const bytes = rasterBytes(layers, 3);
  for (let i = 0; i < 3; i++) {
    const rgba = compositeRgba(layers, i);
    assert.deepEqual([...bytes.slice(i * 4, i * 4 + 4)], [rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * 255)]);
  }
});

test("drag reorder moves the exact layer without changing IDs, locks or original order", () => {
  const layers = [{ id: "a" }, { id: "b", locked: true }, { id: "c" }];
  assert.deepEqual(reorderLayers(layers, 0, 2).map((layer) => layer.id), ["b", "c", "a"]);
  assert.deepEqual(reorderLayers(layers, 2, 0).map((layer) => layer.id), ["c", "a", "b"]);
  assert.equal(reorderLayers(layers, 0, 2)[0].locked, true);
  assert.deepEqual(layers.map((layer) => layer.id), ["a", "b", "c"]);
});

test("invert preserves transparency, complements RGB and is reversible", () => {
  assert.equal(invertColor(null), null);
  assert.equal(invertColor("#000000"), "#ffffff");
  assert.equal(invertColor("#123456"), "#edcba9");
  assert.equal(invertColor(invertColor("#123456")), "#123456");
});

test("lab layer names reuse gaps without duplicating existing labels", () => {
  assert.equal(nextLayerName([{ name: "Layer 2" }, { name: "Layer 3" }]), "Layer 1");
  assert.equal(nextLayerName([{ name: "Layer 1" }, { name: "Layer 3" }]), "Layer 2");
  assert.equal(nextLayerName([{ name: "Background" }, { name: "Layer 1" }]), "Layer 2");
});

test("lab panel widths enforce limits and reserve space for drawing", () => {
  assert.equal(panelWidth("left", 900, 234, 1280), 320);
  assert.equal(panelWidth("right", 20, 132, 1280), 190);
  assert.equal(panelWidth("right", 420, 320, 900), 326);
  assert.equal(panelWidth("left", 250, 234, 600), 112);
});

test("lab pointer positions use rectangular canvas coordinates and clamp captured pointers", () => {
  const bounds = { left: 100, top: 50, width: 640, height: 320 };
  assert.equal(pointerPixel(420, 210, bounds, 32, 16), 8 * 32 + 16);
  assert.equal(pointerPixel(-10, -10, bounds, 32, 16), 0);
  assert.equal(pointerPixel(1000, 1000, bounds, 32, 16), 511);
});

test("live selection moves start from original pixels; paste clips after resize", () => {
  const pixels = ["#ff0000", "#00ff00", null, null, null, null, null, null];
  const selection = { x: 0, y: 0, width: 2, height: 1 };
  const moved = movePixels(pixels, selection, 1, 1, 4, 2);
  assert.deepEqual(moved.pixels, [null, null, null, null, null, "#ff0000", "#00ff00", null]);
  assert.equal(pixels[0], "#ff0000");
  const pasted = pastePixels([null], { width: 2, height: 1, pixels: ["#ff0000", "#00ff00"] }, 0, 0, 1, 1);
  assert.deepEqual(pasted.selection, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(pasted.pixels, ["#ff0000"]);
});

test("pasted selections restore background after repeated nudges and ignore transparent pixels", () => {
  const base = ["#000001", "#000002", "#000003", "#000004", "#000005"];
  const clip = { width: 2, height: 1, pixels: ["#ff0000", null] };
  assert.deepEqual(placeFloating(base, clip, 0, 0, 5, 1).pixels, ["#ff0000", "#000002", "#000003", "#000004", "#000005"]);
  const nudged = placeFloating(base, clip, 1, 0, 5, 1);
  assert.deepEqual(nudged.pixels, ["#000001", "#ff0000", "#000003", "#000004", "#000005"]);
  assert.deepEqual(placeFloating(base, clip, 2, 0, 5, 1).pixels, ["#000001", "#000002", "#ff0000", "#000004", "#000005"]);
  assert.deepEqual(placeFloating(base, clip, 0, 0, 5, 1).selection, { x: 0, y: 0, width: 2, height: 1 });
  assert.equal(placeFloating(base, clip, 99, 0, 5, 1).selection.x, 3);
});

test("deleting a default layer renumbers later defaults without changing custom names or IDs", () => {
  const layers = [{ id: "a", name: "Layer 1" }, { id: "c", name: "Layer 3" }, { id: "d", name: "Layer 4" }, { id: "e", name: "Layer 5" }];
  assert.deepEqual(renumberLayers(layers).map((layer) => layer.name), ["Layer 1", "Layer 2", "Layer 3", "Layer 4"]);
  assert.equal(renumberLayers(layers)[1].id, "c");
  assert.deepEqual(renumberLayers([{ name: "Sky" }, { name: "Layer 8", customName: true }, { name: "Layer 3" }]).map((layer) => layer.name), ["Sky", "Layer 8", "Layer 1"]);
});

test("zoom clamps extreme pinch scales while retaining fractional zoom", () => {
  assert.equal(zoomScale(1, 1.25), 1.25);
  assert.equal(zoomScale(4, 0.5), 2);
  assert.equal(zoomScale(1, 999), 64);
  assert.equal(zoomScale(1, 0.001), 0.125);
});

test("lossless transforms preserve rectangular clips and transparent pixels", () => {
  const clip = { width: 3, height: 2, pixels: ["a", "b", null, "d", "e", "f"] };
  assert.deepEqual(transformClip(clip, "flipX").pixels, [null, "b", "a", "f", "e", "d"]);
  assert.deepEqual(transformClip(clip, "flipY").pixels, ["d", "e", "f", "a", "b", null]);
  const rotated = transformClip(clip, "rotate");
  assert.deepEqual(rotated, { width: 2, height: 3, pixels: ["d", "a", "e", "b", "f", null] });
  assert.deepEqual(transformClip(transformClip(transformClip(rotated, "rotate"), "rotate"), "rotate"), clip);
});

test("dither densities use a stable pattern in canvas coordinates", () => {
  for (const density of [25, 50, 75]) {
    assert.equal([0, 1, 4, 5].filter((index) => ditherAccept(index, 4, density)).length, density / 25);
  }
  assert.equal(ditherAccept(0, 4, 50), true);
  assert.equal(ditherAccept(1, 4, 50), false);
  assert.equal(ditherAccept(5, 4, 50), true);
});
