export const TRANSPARENT = null;

export function validEditorDraft(document, requiredSize = null) {
  if (!document || !Number.isInteger(document.width) || !Number.isInteger(document.height) ||
      document.width < 1 || document.height < 1 || document.width > 4096 || document.height > 4096 ||
      document.width * document.height > 1048576 ||
      (requiredSize && (document.width !== requiredSize || document.height !== requiredSize)) ||
      !Array.isArray(document.frames) || !document.frames.length) return false;
  return document.frames.every(frame => frame && Array.isArray(frame.layers) && frame.layers.length &&
    frame.layers.every(layer => layer && typeof layer.name === "string" && Number.isFinite(layer.opacity) && layer.opacity >= 0 && layer.opacity <= 1 &&
      typeof layer.visible === "boolean" && Array.isArray(layer.pixels) &&
      layer.pixels.length === document.width * document.height && layer.pixels.every(color => color === null || (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))))) &&
    document.frames.reduce((total, frame) => total + frame.layers.length * document.width * document.height, 0) <= 16777216;
}

export function makePixels(width, height, color = TRANSPARENT) {
  return Array(width * height).fill(color);
}

export function makeLayer(width, height, name = "Layer 1", color = TRANSPARENT) {
  return { id: crypto.randomUUID(), name, opacity: 1, visible: true, pixels: makePixels(width, height, color) };
}

export function makeFrame(width, height, layers = null) {
  return {
    id: crypto.randomUUID(),
    layers: layers || [makeLayer(width, height, "Layer 1", "#ffffff")],
  };
}

export function resizePixels(pixels, oldWidth, oldHeight, width, height) {
  const resized = makePixels(width, height);
  for (let row = 0; row < Math.min(oldHeight, height); row++) {
    for (let column = 0; column < Math.min(oldWidth, width); column++) {
      resized[row * width + column] = pixels[row * oldWidth + column];
    }
  }
  return resized;
}

export function resizeFrames(frames, oldWidth, oldHeight, width, height) {
  return frames.map((frame) => ({
    ...frame,
    layers: frame.layers.map((layer) => ({
      ...layer,
      pixels: resizePixels(layer.pixels, oldWidth, oldHeight, width, height),
    })),
  }));
}

function colorChannels(color) {
  return [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
}

export function compositeRgba(layers, index, background = null) {
  let [red, green, blue, alpha] = background ? [...colorChannels(background), 1] : [0, 0, 0, 0];
  for (const layer of layers) {
    const color = layer.visible ? layer.pixels[index] : null;
    if (!color) continue;
    const [nextRed, nextGreen, nextBlue] = colorChannels(color);
    const nextAlpha = Math.max(0, Math.min(1, layer.opacity));
    const combinedAlpha = nextAlpha + alpha * (1 - nextAlpha);
    if (!combinedAlpha) continue;
    red = (nextRed * nextAlpha + red * alpha * (1 - nextAlpha)) / combinedAlpha;
    green = (nextGreen * nextAlpha + green * alpha * (1 - nextAlpha)) / combinedAlpha;
    blue = (nextBlue * nextAlpha + blue * alpha * (1 - nextAlpha)) / combinedAlpha;
    alpha = combinedAlpha;
  }
  return [Math.round(red), Math.round(green), Math.round(blue), alpha];
}

export function rgbaCss(rgba) {
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]})`;
}

export function rgbaHex(rgba, background = "#ffffff") {
  const base = colorChannels(background);
  const channels = rgba.slice(0, 3).map((channel, index) =>
    Math.round(channel * rgba[3] + base[index] * (1 - rgba[3])));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function flattenFrame(frame, background = "#ffffff") {
  return frame.layers[0].pixels.map((_color, index) => rgbaHex(compositeRgba(frame.layers, index), background));
}

export function brushIndices(center, width, height, size, mirrorX = false, mirrorY = false) {
  const row = Math.floor(center / width);
  const column = center % width;
  const offset = Math.floor((size - 1) / 2);
  const centers = [[row, column]];
  if (mirrorX) centers.push([row, width - 1 - column]);
  if (mirrorY) centers.push([height - 1 - row, column]);
  if (mirrorX && mirrorY) centers.push([height - 1 - row, width - 1 - column]);
  const result = new Set();
  for (const [centerRow, centerColumn] of centers) {
    for (let y = centerRow - offset; y < centerRow - offset + size; y++) {
      for (let x = centerColumn - offset; x < centerColumn - offset + size; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) result.add(y * width + x);
      }
    }
  }
  return [...result];
}

export function lineIndices(start, end, width) {
  let x0 = start % width;
  let y0 = Math.floor(start / width);
  const x1 = end % width;
  const y1 = Math.floor(end / width);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  const result = [];
  while (true) {
    result.push(y0 * width + x0);
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
  return result;
}

export function rectangleIndices(start, end, width) {
  const x0 = Math.min(start % width, end % width);
  const x1 = Math.max(start % width, end % width);
  const y0 = Math.min(Math.floor(start / width), Math.floor(end / width));
  const y1 = Math.max(Math.floor(start / width), Math.floor(end / width));
  const result = new Set();
  for (let x = x0; x <= x1; x++) { result.add(y0 * width + x); result.add(y1 * width + x); }
  for (let y = y0; y <= y1; y++) { result.add(y * width + x0); result.add(y * width + x1); }
  return [...result];
}

export function ellipseIndices(start, end, width) {
  const x0 = Math.min(start % width, end % width);
  const x1 = Math.max(start % width, end % width);
  const y0 = Math.min(Math.floor(start / width), Math.floor(end / width));
  const y1 = Math.max(Math.floor(start / width), Math.floor(end / width));
  const radiusX = (x1 - x0) / 2;
  const radiusY = (y1 - y0) / 2;
  const centerX = x0 + radiusX;
  const centerY = y0 + radiusY;
  if (!radiusX || !radiusY) return lineIndices(start, end, width);
  const result = new Set();
  const steps = Math.max(16, Math.ceil(Math.max(radiusX, radiusY) * 12));
  for (let step = 0; step < steps; step++) {
    const angle = step / steps * Math.PI * 2;
    const x = Math.round(centerX + radiusX * Math.cos(angle));
    const y = Math.round(centerY + radiusY * Math.sin(angle));
    result.add(y * width + x);
  }
  result.delete(y0 * width + x0);
  result.delete(y0 * width + x1);
  result.delete(y1 * width + x0);
  result.delete(y1 * width + x1);
  return [...result];
}

export function fillArea(pixels, startIndex, newColor, width, height) {
  const oldColor = pixels[startIndex];
  if (oldColor === newColor) return pixels;
  const updated = [...pixels];
  const pending = [startIndex];
  while (pending.length) {
    const index = pending.pop();
    if (updated[index] !== oldColor) continue;
    updated[index] = newColor;
    const row = Math.floor(index / width);
    const column = index % width;
    if (row > 0) pending.push(index - width);
    if (row < height - 1) pending.push(index + width);
    if (column > 0) pending.push(index - 1);
    if (column < width - 1) pending.push(index + 1);
  }
  return updated;
}

export function selectionFromIndices(start, end, width) {
  const startX = start % width;
  const startY = Math.floor(start / width);
  const endX = end % width;
  const endY = Math.floor(end / width);
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  return { x, y, width: Math.abs(endX - startX) + 1, height: Math.abs(endY - startY) + 1 };
}

export function selectionContains(selection, index, width) {
  if (!selection) return false;
  const x = index % width;
  const y = Math.floor(index / width);
  return x >= selection.x && x < selection.x + selection.width &&
    y >= selection.y && y < selection.y + selection.height;
}

export function copyPixels(pixels, selection, canvasWidth) {
  const copied = [];
  for (let y = 0; y < selection.height; y++) {
    for (let x = 0; x < selection.width; x++) {
      copied.push(pixels[(selection.y + y) * canvasWidth + selection.x + x]);
    }
  }
  return { width: selection.width, height: selection.height, pixels: copied };
}

export function pastePixels(pixels, clipboard, targetX, targetY, width, height) {
  const x = Math.max(0, Math.min(width - clipboard.width, targetX));
  const y = Math.max(0, Math.min(height - clipboard.height, targetY));
  const updated = [...pixels];
  const pastedWidth = Math.min(clipboard.width, width);
  const pastedHeight = Math.min(clipboard.height, height);
  for (let row = 0; row < pastedHeight; row++) {
    for (let column = 0; column < pastedWidth; column++) {
      updated[(y + row) * width + x + column] = clipboard.pixels[row * clipboard.width + column];
    }
  }
  return { pixels: updated, selection: { x, y, width: pastedWidth, height: pastedHeight } };
}

export function movePixels(pixels, selection, deltaX, deltaY, width, height) {
  const targetX = Math.max(0, Math.min(width - selection.width, selection.x + deltaX));
  const targetY = Math.max(0, Math.min(height - selection.height, selection.y + deltaY));
  if (targetX === selection.x && targetY === selection.y) return { pixels, selection };
  const copied = copyPixels(pixels, selection, width);
  const updated = [...pixels];
  for (let y = selection.y; y < selection.y + selection.height; y++) {
    for (let x = selection.x; x < selection.x + selection.width; x++) updated[y * width + x] = null;
  }
  return pastePixels(updated, copied, targetX, targetY, width, height);
}
