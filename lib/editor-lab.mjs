// Pixel-editor helpers shared by the main studio and isolated local lab.
export function nextLayerName(layers) {
  const names = new Set(layers.map((layer) => layer.name));
  let number = 1;
  while (names.has(`Layer ${number}`)) number++;
  return `Layer ${number}`;
}

export function pointerPixel(clientX, clientY, bounds, width, height) {
  const x = Math.max(0, Math.min(width - 1, Math.floor((clientX - bounds.left) / bounds.width * width)));
  const y = Math.max(0, Math.min(height - 1, Math.floor((clientY - bounds.top) / bounds.height * height)));
  return y * width + x;
}

export function panelWidth(side, requested, otherWidth, workspaceWidth) {
  const minimum = side === "left" ? 112 : 190;
  const maximum = side === "left" ? 320 : 420;
  // Reserve 240px for drawing and 14px for the two resize handles.
  const available = Math.max(minimum, workspaceWidth - otherWidth - 254);
  return Math.round(Math.max(minimum, Math.min(maximum, available, requested)));
}

export function renumberLayers(layers) {
  let number = 0;
  return layers.map((layer) => /^Layer \d+$/.test(layer.name) && !layer.customName
    ? { ...layer, name: `Layer ${++number}` } : layer);
}

// Transparent clipboard pixels do not replace the artwork underneath.
export function placeFloating(base, clip, targetX, targetY, width, height) {
  const pastedWidth = Math.min(width, clip.width);
  const pastedHeight = Math.min(height, clip.height);
  const x = Math.max(0, Math.min(width - pastedWidth, targetX));
  const y = Math.max(0, Math.min(height - pastedHeight, targetY));
  const pixels = [...base];
  for (let row = 0; row < pastedHeight; row++) {
    for (let column = 0; column < pastedWidth; column++) {
      const color = clip.pixels[row * clip.width + column];
      if (color !== null) pixels[(y + row) * width + x + column] = color;
    }
  }
  return { pixels, selection: { x, y, width: pastedWidth, height: pastedHeight } };
}

export function zoomScale(scale, factor) {
  return Math.max(0.125, Math.min(64, scale * factor));
}

// Invert RGB without turning transparent cells into painted pixels.
export function invertColor(color) {
  if (color === null) return null;
  return `#${(0xffffff ^ Number.parseInt(color.slice(1), 16)).toString(16).padStart(6, "0")}`;
}

// Cache palette decoding during a full render, rather than parsing RGB for each cell.
export function rasterBytes(layers, count) {
  const values = new Float64Array(count * 4);
  const colors = new Map();
  for (const layer of layers) {
    if (!layer.visible || layer.opacity === 0) continue;
    const a = layer.opacity;
    for (let i = 0; i < count; i++) {
      const color = layer.pixels[i];
      if (!color) continue;
      let rgb = colors.get(color);
      if (!rgb) {
        const value = Number.parseInt(color.slice(1), 16);
        rgb = [value >> 16, (value >> 8) & 255, value & 255];
        colors.set(color, rgb);
      }
      const offset = i * 4;
      const oldAlpha = values[offset + 3];
      const alpha = a + oldAlpha * (1 - a);
      for (let channel = 0; channel < 3; channel++) values[offset + channel] =
        (rgb[channel] * a + values[offset + channel] * oldAlpha * (1 - a)) / alpha;
      values[offset + 3] = alpha;
    }
  }
  const bytes = new Uint8ClampedArray(values.length);
  for (let offset = 0; offset < values.length; offset += 4) {
    bytes[offset] = Math.round(values[offset]);
    bytes[offset + 1] = Math.round(values[offset + 1]);
    bytes[offset + 2] = Math.round(values[offset + 2]);
    bytes[offset + 3] = Math.round(values[offset + 3] * 255);
  }
  return bytes;
}

export function reorderLayers(layers, from, to) {
  const reordered = [...layers];
  const [layer] = reordered.splice(from, 1);
  reordered.splice(to, 0, layer);
  return reordered;
}

export function brushFootprints(center, width, height, size, mirrorX = false, mirrorY = false) {
  const x = center % width, y = Math.floor(center / width);
  const xs = mirrorX ? [x, width - 1 - x] : [x];
  const ys = mirrorY ? [y, height - 1 - y] : [y];
  const offset = Math.floor((size - 1) / 2);
  return ys.flatMap((cy) => xs.map((cx) => {
    const left = Math.max(0, cx - offset), top = Math.max(0, cy - offset);
    return { x: left, y: top, width: Math.min(width, cx - offset + size) - left,
      height: Math.min(height, cy - offset + size) - top };
  }));
}

export function transformClip(clip, operation) {
  const rotated = operation === "rotate";
  const width = rotated ? clip.height : clip.width;
  const height = rotated ? clip.width : clip.height;
  const pixels = Array(width * height).fill(null);
  for (let y = 0; y < clip.height; y++) {
    for (let x = 0; x < clip.width; x++) {
      const targetX = rotated ? clip.height - 1 - y : operation === "flipX" ? clip.width - 1 - x : x;
      const targetY = rotated ? x : operation === "flipY" ? clip.height - 1 - y : y;
      pixels[targetY * width + targetX] = clip.pixels[y * clip.width + x];
    }
  }
  return { width, height, pixels };
}

export function ditherAccept(index, width, density = 50) {
  const pattern = [[0, 2], [3, 1]];
  const x = index % width;
  const y = Math.floor(index / width);
  return pattern[y % 2][x % 2] < density / 25;
}
