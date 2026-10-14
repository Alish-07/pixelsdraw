"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { editorDraftKeys, readLabDraft, saveLabDraft } from "@/lib/editor-lab-storage.mjs";
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { allowsCanvas, canvasRules, describeCanvas, validateCompetitionArtwork } from "@/lib/competition-rules.mjs";
import { useTheme } from "./ThemeProvider";
import { savedFrameRate } from "@/lib/site-ui.mjs";
import { brushFootprints, ditherAccept, invertColor, rasterBytes, reorderLayers, nextLayerName, panelWidth, placeFloating, pointerPixel, renumberLayers, transformClip, zoomScale } from "@/lib/editor-lab.mjs";
import {
  brushIndices, compositeRgba, copyPixels, ellipseIndices, fillArea, flattenFrame, lineIndices,
  makeFrame, makeLayer, rectangleIndices, resizeFrames, validEditorDraft,
  rgbaHex, selectionContains, selectionFromIndices,
} from "@/lib/pixel-document.mjs";

const OLD_STORAGE_KEY = "pixel-art-studio:draft:v1";
const HISTORY_LIMIT = 30;
const MAX_PIXELS = 1048576;
const MAX_DOCUMENT_PIXELS = 16777216;
const HISTORY_PIXELS = 4194304;
const PRESETS = [[16, 16], [24, 24], [32, 32], [48, 48], [64, 64], [128, 128], [256, 256], [512, 512], [1000, 1000], [1024, 1024], [16, 24], [32, 48], [48, 32], [64, 32]];
const DEFAULT_COLORS = ["#000000", "#4b5563", "#9ca3af", "#ffffff", "#dc2626", "#f97316", "#facc15", "#16a34a", "#06b6d4", "#2563eb", "#7c3aed", "#ec4899", "#7f1d1d", "#365314", "#1e3a8a", "#fb7185"];
const CUSTOM_PALETTE = Array(8).fill(null);

const TOOL_HELP = {
  pencil: "Paint pixels using the current color and brush size. Hold and drag to draw.",
  dither: "Paint a repeating pixel pattern for textured shading. Density controls how much of the area is painted.",
  eraser: "Remove pixels from the active layer, revealing layers below or transparency.",
  fill: "Fill a connected area of matching pixels on the active layer.",
  picker: "Pick the visible color under your pointer, including stacked layers.",
  line: "Drag to preview a straight pixel line. Release to draw it.",
  rectangle: "Drag to preview a rectangular outline. Release to draw it.",
  ellipse: "Drag to preview a circle or oval outline. Release to draw it.",
  replace: "Replace every occurrence of the clicked color on the active layer, including disconnected areas.",
  select: "Drag a rectangular selection, then copy, clear, move or transform its pixels.",
  move: "Drag the selected pixels to reposition them. Arrow keys move one pixel; Shift moves five.",
};

const TOOLS = [
  { id: "pencil", icon: "✎", label: "Pencil", shortcut: "P" },
  { id: "dither", icon: "▦", label: "Dither", shortcut: "D" },
  { id: "eraser", icon: "◇", label: "Eraser", shortcut: "E" },
  { id: "fill", icon: "▣", label: "Fill", shortcut: "F" },
  { id: "picker", icon: "◉", label: "Picker", shortcut: "I" },
  { id: "line", icon: "╱", label: "Line", shortcut: "L" },
  { id: "rectangle", icon: "□", label: "Rectangle", shortcut: "R" },
  { id: "ellipse", icon: "○", label: "Circle", shortcut: "C" },
  { id: "replace", icon: "↺", label: "Replace", shortcut: "A" },
  { id: "select", icon: "⌗", label: "Select", shortcut: "S" },
  { id: "move", icon: "✥", label: "Move", shortcut: "M" },
];

function starterDocument(size = 16) {
  return {
    width: size,
    height: size,
    frames: [{ id: "frame-1", layers: [{
      id: "layer-1", name: "Layer 1", opacity: 1, visible: true,
      pixels: Array(size * size).fill(null),
    }] }],
  };
}

function isColor(color) {
  return color === null || (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color));
}

function validDocument(document, requiredSize) {
  return validEditorDraft(document, requiredSize);
}

function clone(value) {
  return structuredClone(value);
}

function RasterSurface({ layers, width, height, label, surfaceRef }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(width, height);
    image.data.set(rasterBytes(layers, width * height));
    context.putImageData(image, 0, 0);
    if (surfaceRef) surfaceRef.current = {
      paint(indices, strokeLayers) {
        for (const index of indices) {
          const rgba = compositeRgba(strokeLayers, index);
          const x = index % width, y = Math.floor(index / width);
          context.clearRect(x, y, 1, 1);
          if (rgba[3]) { context.fillStyle = `rgba(${rgba.join(",")})`; context.fillRect(x, y, 1, 1); }
        }
      },
      restore() { context.putImageData(image, 0, 0); },
    };
  }, [layers, height, width, surfaceRef]);
  return <canvas ref={canvasRef} width={width} height={height} role="img" aria-label={label} />;
}
function FramePreview({ frame, width, height, label }) {
  return <RasterSurface layers={frame.layers} width={width} height={height} label={label} />;
}

function ShapePreview({ indices, width, height, color }) {
  const ref = useRef(null);
  useEffect(() => {
    const context = ref.current.getContext("2d");
    context.clearRect(0, 0, width, height);
    context.fillStyle = color;
    indices.forEach((index) => context.fillRect(index % width, Math.floor(index / width), 1, 1));
  }, [indices, width, height, color]);
  return <canvas className="shape-preview" ref={ref} width={width} height={height} aria-hidden="true" />;
}

export default function PixelCanvas({ isActive = true, competition = null, onSubmitArtwork, participantName = "", storageScope = "main" }) {
  const rules = canvasRules(competition);
  const requiredSize = competition && rules.mode === "fixed" ? rules.sizes[0] : null;
  const defaultSize = competition?.size || 16;
  const ruleKey = competition ? JSON.stringify(rules) : "";
  const animationDisabled = competition && (competition.animation_mode || "disabled") === "disabled";
  const { primary: draftKey, legacy: legacyKey, labFallback } = editorDraftKeys(competition?.id, storageScope);
  const { theme, preference, setPreference } = useTheme();
  const initial = starterDocument(defaultSize);
  const [width, setWidth] = useState(initial.width);
  const [height, setHeight] = useState(initial.height);
  const [frames, setFrames] = useState(initial.frames);
  const [activeFrame, setActiveFrame] = useState(0);
  const [activeLayer, setActiveLayer] = useState(0);
  const [loadedDraftKey, setLoadedDraftKey] = useState(null);
  const loaded = loadedDraftKey === draftKey;
  const [saveStatus, setSaveStatus] = useState("Loading draft…");
  const [selectedColor, setSelectedColor] = useState("#7c3aed");
  const [palette, setPalette] = useState(CUSTOM_PALETTE);
  const [activeTool, setActiveTool] = useState("pencil");
  const [pencilSize, setPencilSize] = useState(1);
  const [eraserSize, setEraserSize] = useState(1);
  const [universalSize, setUniversalSize] = useState(false);
  const brushSize = activeTool === "eraser" ? eraserSize : pencilSize;
  function setBrushSize(value) {
    const next = typeof value === "function" ? value(brushSize) : value;
    if (universalSize || activeTool !== "eraser") setPencilSize(next);
    if (universalSize || activeTool === "eraser") setEraserSize(next);
  }
  const surfaceRef = useRef(null);
  const draggedLayer = useRef(null);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [showGrid, setShowGrid] = useState(true);
  const [onionSkin, setOnionSkin] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [exportScale, setExportScale] = useState(8);
  const [exportStatus, setExportStatus] = useState("");
  const [submissionMessage, setSubmissionMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [fps, setFps] = useState(6);
  const [selection, setSelection] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [floating, setFloating] = useState(null);
  const [zoom, setZoom] = useState(0);
  const [helpEnabled, setHelpEnabled] = useState(true);
  const [toolHint, setToolHint] = useState(null);
  const hintTimer = useRef(null);
  const [resizablePanels, setResizablePanels] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [eraserPreview, setEraserPreview] = useState(true);
  const [autoCloseMenus, setAutoCloseMenus] = useState(true);
  const [checkerA, setCheckerA] = useState("#dedee3");
  const [checkerB, setCheckerB] = useState("#cbcbd2");
  const [backgroundMode, setBackgroundMode] = useState("checker");
  const [shapePreview, setShapePreview] = useState([]);
  const [ditherDensity, setDitherDensity] = useState(50);
  const [editingLayer, setEditingLayer] = useState(null);
  const renameCancelled = useRef(false);
  const viewportRef = useRef(null);
  const zoomAnchor = useRef(null);
  const touchPoints = useRef(new Map());
  const pinch = useRef(null);
  const fadeTimer = useRef(null);
  const [editingSlot, setEditingSlot] = useState(null);
  const menusRef = useRef(null);
  const menuTimer = useRef(null);
  const shortcutsRef = useRef(null);
  const [panel, setPanel] = useState("layers");
  const [artworkTitle, setArtworkTitle] = useState("Untitled artwork");
  const [editingTitle, setEditingTitle] = useState(false);
  const [leftWidth, setLeftWidth] = useState(132);
  const [rightWidth, setRightWidth] = useState(234);
  const [cursorPixel, setCursorPixel] = useState(null);
  const workspaceRef = useRef(null);
  const panelDrag = useRef(null);
  const gesture = useRef(null);
  const gridRef = useRef(null);
  const shapeStart = useRef(null);

  const currentFrame = frames[activeFrame];
  const currentLayer = currentFrame?.layers[activeLayer];
  const displayLayers = useMemo(() => {
    if (!currentFrame) return [];
    if (!onionSkin || activeFrame === 0) return currentFrame.layers;
    const previous = frames[activeFrame - 1].layers.map((layer) => ({ ...layer, opacity: layer.opacity * 0.22 }));
    return [...previous, ...currentFrame.layers];
  }, [activeFrame, currentFrame, frames, onionSkin]);


  useEffect(() => {
    let cancelled = false;
    async function loadDraft() {
    try {
      let stored = null;
      try { stored = await readLabDraft(draftKey); } catch { /* Fall back to the older browser draft. */ }
      if (cancelled) return;
      let saved = null;
      let oldSaved = null;
      try {
        saved = localStorage.getItem(draftKey) || localStorage.getItem(legacyKey);
        oldSaved = !competition && !stored && !saved ? localStorage.getItem(OLD_STORAGE_KEY) : null;
      } catch { /* IndexedDB drafts still work when localStorage is unavailable. */ }
      if (!stored && !saved && labFallback) { try { stored = await readLabDraft(labFallback); } catch { /* Start a fresh main draft if no lab draft exists. */ } }
      let document = stored || (saved ? JSON.parse(saved) : null);
      if (!document && oldSaved) {
        const old = JSON.parse(oldSaved);
        document = starterDocument(old.size);
        document.frames[0].layers[0].pixels = old.pixels;
      }
      if (cancelled) return;
      // A newly opened room must start at its required size, never reuse the
      // preceding room's unsaved state or its undo history.
      setSelection(null);
      setFloating(null);
      setHistory([]);
      setFuture([]);
      setPlaying(false);
      setPreviewFrame(0);
      if (!document) {
        const fresh = starterDocument(defaultSize);
        setWidth(fresh.width);
        setHeight(fresh.height);
        setFrames(fresh.frames);
        setActiveFrame(0);
        setActiveLayer(0);
        setArtworkTitle("Untitled artwork");
        setFps(6);
      }
      if (document) {
        if (!validDocument(document, requiredSize) || (competition && !allowsCanvas(canvasRules(competition), document.width, document.height))) throw new Error("Invalid draft");
        setWidth(document.width);
        setHeight(document.height);
        setFrames(document.frames);
        setFps(savedFrameRate(document.fps));
        if (typeof document.helpEnabled === "boolean") setHelpEnabled(document.helpEnabled);
        for (const [key, setter] of [["resizablePanels", setResizablePanels], ["showCoordinates", setShowCoordinates], ["eraserPreview", setEraserPreview], ["autoCloseMenus", setAutoCloseMenus], ["showGrid", setShowGrid]]) {
          if (typeof document[key] === "boolean") setter(document[key]);
        }
        if (typeof document.checkerA === "string" && isColor(document.checkerA)) setCheckerA(document.checkerA);
        if (typeof document.checkerB === "string" && isColor(document.checkerB)) setCheckerB(document.checkerB);
        if (document.backgroundMode === "solid") setBackgroundMode("solid");
        if (Number.isInteger(document.brushSize) && document.brushSize >= 1 && document.brushSize <= 32) { setPencilSize(document.brushSize); setEraserSize(document.brushSize); }
        if (Number.isInteger(document.pencilSize) && document.pencilSize >= 1 && document.pencilSize <= 32) setPencilSize(document.pencilSize);
        if (Number.isInteger(document.eraserSize) && document.eraserSize >= 1 && document.eraserSize <= 32) setEraserSize(document.eraserSize);
        setUniversalSize(document.universalSize === true);
        if (typeof document.artworkTitle === "string" && document.artworkTitle.trim()) setArtworkTitle(document.artworkTitle.slice(0, 80));
        if (Number.isFinite(document.leftWidth)) setLeftWidth(Math.max(112, Math.min(320, document.leftWidth)));
        if (Number.isFinite(document.rightWidth)) setRightWidth(Math.max(190, Math.min(420, document.rightWidth)));
        const frameIndex = Math.max(0, Math.min(document.activeFrame || 0, document.frames.length - 1));
        setActiveFrame(frameIndex);
        setActiveLayer(Math.max(0, Math.min(document.activeLayer || 0, document.frames[frameIndex].layers.length - 1)));
        if (Array.isArray(document.palette) && document.palette.every(isColor)) {
          const oldDefaults = ["#111827", "#ffffff", "#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#7c3aed"];
          const colors = document.palette.map((color, index) => !document.paletteSlots && color === oldDefaults[index] ? null : color);
          setPalette(colors.slice(0, 8).concat(Array(8).fill(null)).slice(0, 8));
        }
      }
      setSaveStatus("Saved in this browser");
    } catch {
      setSaveStatus("Draft could not be loaded. Export a PNG to keep your work.");
    }
    if (!cancelled) { if (competition) setZoom(0); setLoadedDraftKey(draftKey); }
    }
    loadDraft();
    return () => { cancelled = true; };
  // Rules use a stable serialized key so polling does not reload the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, legacyKey, labFallback, requiredSize, defaultSize, ruleKey]);

  useEffect(() => {
    if (!loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveStatus("Saving…");
    let cancelled = false;
    const timer = setTimeout(async () => {
      const document = { version: 3, width, height, frames, activeFrame, activeLayer, fps,
        palette, paletteSlots: true, artworkTitle, leftWidth, rightWidth, resizablePanels, showCoordinates, eraserPreview, autoCloseMenus, showGrid, checkerA, checkerB, backgroundMode, brushSize, pencilSize, eraserSize, universalSize, helpEnabled };
      try {
        try { await saveLabDraft(draftKey, document); }
        catch { localStorage.setItem(draftKey, JSON.stringify(document)); }
        if (!cancelled) setSaveStatus("Saved in this browser");
      } catch {
        if (!cancelled) setSaveStatus("Browser save unavailable. Export your work before leaving.");
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeFrame, activeLayer, draftKey, frames, fps, height, loaded, palette, width, artworkTitle, leftWidth, rightWidth, resizablePanels, showCoordinates, eraserPreview, autoCloseMenus, showGrid, checkerA, checkerB, backgroundMode, brushSize, pencilSize, eraserSize, universalSize, helpEnabled]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => setPreviewFrame((index) => (index + 1) % frames.length), 1000 / fps);
    return () => window.clearInterval(timer);
  }, [fps, frames.length, playing]);

  useEffect(() => {
    function dismiss(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && menusRef.current?.contains(event.target)) return;
      menusRef.current?.querySelectorAll("details[open]").forEach((menu) => { menu.open = false; });
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
      clearTimeout(menuTimer.current);
      clearTimeout(fadeTimer.current);
      clearTimeout(hintTimer.current);
    };
  }, []);
  function cancelMenuFade() {
    clearTimeout(menuTimer.current);
    clearTimeout(fadeTimer.current);
    menusRef.current?.querySelectorAll(".menu-fading").forEach((menu) => menu.classList.remove("menu-fading"));
  }
  function closeMenus() {
    cancelMenuFade();
    menusRef.current?.querySelectorAll("details[open]").forEach((menu) => { menu.open = false; });
  }
  function menuProps() {
    return {
      name: "editor-lab-menu",
      onToggle: (event) => {
        if (event.currentTarget.open) menusRef.current?.querySelectorAll("details").forEach((menu) => {
          if (menu !== event.currentTarget) menu.open = false;
        });
      },
      onPointerEnter: cancelMenuFade,
      onPointerLeave: (event) => {
        if (!autoCloseMenus) { cancelMenuFade(); return; }
        if (event.currentTarget.querySelector("input:focus, select:focus")) return;
        cancelMenuFade();
        const menu = event.currentTarget;
        fadeTimer.current = setTimeout(() => menu.classList.add("menu-fading"), 1000);
        menuTimer.current = setTimeout(closeMenus, 3000);
      },
      onFocusCapture: cancelMenuFade,
    };
  }
  function commitSelection() {
    setFloating(null);
    setSelection(null);
  }
  function selectAll() {
    setFloating(null);
    setSelection({ x: 0, y: 0, width, height });
    setActiveTool("select");
  }
  function hideToolHint() {
    clearTimeout(hintTimer.current);
    setToolHint(null);
  }
  function helpProps(label, description) {
    function show(event) {
      hideToolHint();
      if (!helpEnabled) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const left = Math.max(8, Math.min(window.innerWidth - 268, rect.left));
      const top = Math.max(8, Math.min(window.innerHeight - 150, rect.bottom + 8));
      hintTimer.current = setTimeout(() => setToolHint({ label, description, left, top }), 750);
    }
    return { onPointerEnter: show, onPointerLeave: hideToolHint, onFocus: show, onBlur: hideToolHint,
      onPointerDown: hideToolHint, "data-expanded-help": toolHint?.label === label ? "true" : "false", "aria-describedby": toolHint?.label === label ? "lab-tool-help" : undefined };
  }
  // Rebind after renders so shortcuts always use the current document and selection.
  useEffect(() => {
    function chooseTool(event) {
      if (!loaded || !isActive || isDrawing || shortcutsRef.current?.open || event.target.closest("input, select, textarea, [contenteditable=true]")) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        const commands = {
          z: event.shiftKey ? redo : undo, y: redo, c: copySelection, v: pasteSelection,
          x: () => { copySelection(); clearSelectionPixels(); },
          a: selectAll,
        };
        if (commands[key]) { event.preventDefault(); commands[key](); }
        return;
      }
      if (event.altKey) return;
      if (["+", "=", "-"].includes(event.key)) {
        event.preventDefault();
        const rect = viewportRef.current.getBoundingClientRect();
        zoomAt(event.key === "-" ? 0.8 : 1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      if (event.key === "0") setZoom(0);
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (selection && arrows[event.key]) {
        event.preventDefault();
        moveSelection(...arrows[event.key].map((amount) => amount * (event.shiftKey ? 5 : 1)));
      }
      if (selection && ["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); clearSelectionPixels(); }
      const tool = { d: "dither", p: "pencil", e: "eraser", f: "fill", i: "picker", l: "line", r: "rectangle", c: "ellipse", a: "replace", s: "select", m: "move" }[key];
      if (tool) chooseDrawingTool(tool);
      if (event.key === "[") setBrushSize((size) => Math.max(1, size - 1));
      if (event.key === "]") setBrushSize((size) => Math.min(32, size + 1));
      if (event.key === "Escape") commitSelection();
    }
    window.addEventListener("keydown", chooseTool);
    return () => window.removeEventListener("keydown", chooseTool);
  });

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    if (!anchor || !viewport || !grid) return;
    viewport.scrollLeft = Math.max(0, grid.offsetLeft + anchor.x * zoom - anchor.viewX);
    viewport.scrollTop = Math.max(0, grid.offsetTop + anchor.y * zoom - anchor.viewY);
    zoomAnchor.current = null;
  }, [zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    function wheel(event) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    }
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  });

  function zoomAt(factor, clientX, clientY) {
    const grid = gridRef.current;
    const rect = grid.getBoundingClientRect();
    const view = viewportRef.current.getBoundingClientRect();
    zoomAnchor.current = { x: (clientX - rect.left - grid.clientLeft) / grid.clientWidth * width,
      y: (clientY - rect.top - grid.clientTop) / grid.clientHeight * height,
      viewX: clientX - view.left, viewY: clientY - view.top };
    setZoom(zoomScale(grid.clientWidth / width, factor));
  }

  function touchDown(event) {
    if (event.pointerType !== "touch") return;
    touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.current.size !== 2) return;
    cancelDrawing();
    const points = [...touchPoints.current.values()];
    pinch.current = { distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function touchMove(event) {
    if (!touchPoints.current.has(event.pointerId)) return;
    touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinch.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (touchPoints.current.size < 2) return;
    const points = [...touchPoints.current.values()];
    const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    if (distance && pinch.current.distance) zoomAt(distance / pinch.current.distance, (points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2);
    pinch.current.distance = distance;
  }

  function touchUp(event) {
    touchPoints.current.delete(event.pointerId);
    if (!pinch.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (!touchPoints.current.size) pinch.current = null;
  }

  function resetLayout() {
    setLeftWidth(132);
    setRightWidth(234);
    setZoom(0);
    setExportStatus("Layout reset. Your artwork and colors are unchanged.");
  }

  function resetViewPreferences() {
    resetLayout();
    setResizablePanels(true);
    setShowCoordinates(true);
    setEraserPreview(true);
    setAutoCloseMenus(true);
    setCheckerA("#dedee3");
    setCheckerB("#cbcbd2");
    setBackgroundMode("checker");
    setPencilSize(1);
    setEraserSize(1);
    setUniversalSize(false);
    setShowGrid(true);
    setHelpEnabled(true);
    hideToolHint();
    setExportStatus("View preferences reset. No artwork or palette colors were deleted.");
  }

  function renameLayer(value) {
    if (!editingLayer) return;
    const index = currentFrame.layers.findIndex((layer) => layer.id === editingLayer.id);
    const name = value.trim().slice(0, 30);
    if (!renameCancelled.current && index >= 0 && name && name !== editingLayer.name) updateLayerAt(index, { name, customName: true });
    renameCancelled.current = false;
    setEditingLayer(null);
  }

  function transformArtwork(operation) {
    if (currentLayer.locked) { setExportStatus("Unlock this layer before editing it."); return; }
    const region = selection || { x: 0, y: 0, width, height };
    const item = selection ? floatingSelection() : {
      base: Array(width * height).fill(null), clip: copyPixels(currentLayer.pixels, region, width) };
    const clip = transformClip(item.clip, operation);
    if (clip.width > width || clip.height > height) {
      setExportStatus("The rotated area will not fit. Select a smaller area or resize the canvas first.");
      return;
    }
    rememberDocument();
    const result = placeFloating(item.base, clip, region.x, region.y, width, height);
    updateLayerPixels(() => result.pixels);
    setFloating({ base: item.base, clip });
    setSelection(result.selection);
    setActiveTool("move");
  }

  function chooseDrawingTool(tool) {
    hideToolHint();
    setActiveTool(tool);
    if (!["select", "move"].includes(tool)) commitSelection();
  }

  function invertArtwork() {
    if (currentLayer.locked) { setExportStatus("Unlock this layer before editing it."); return; }
    rememberDocument();
    updateLayerPixels((pixels) => pixels.map((color, index) =>
      !selection || selectionContains(selection, index, width) ? invertColor(color) : color));
    commitSelection();
    setExportStatus("Colors inverted on the active layer. Undo restores the original colors.");
  }

  function resizePanel(side, requested) {
    const next = panelWidth(side, requested, side === "left" ? rightWidth : leftWidth, workspaceRef.current.clientWidth);
    if (side === "left") setLeftWidth(next);
    else setRightWidth(next);
  }

  function panelHandle(side) {
    if (!resizablePanels) return <div className="panel-fixed-rail" aria-hidden="true" />;
    const value = side === "left" ? leftWidth : rightWidth;
    return <div className="panel-resizer" role="separator" aria-label={`Resize ${side} panel`}
      aria-orientation="vertical" aria-valuemin={side === "left" ? 112 : 190}
      aria-valuemax={side === "left" ? 320 : 420} aria-valuenow={value} tabIndex={0}
      title="Drag to resize · Arrow keys adjust · Double-click to reset"
      onDoubleClick={() => resizePanel(side, side === "left" ? 132 : 234)}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = (event.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1);
        resizePanel(side, event.key === "Home" ? (side === "left" ? 132 : 234) : value + direction * (event.shiftKey ? 30 : 10));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        panelDrag.current = { side, startX: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = panelDrag.current;
        if (drag?.side === side) resizePanel(side, drag.value + (event.clientX - drag.startX) * (side === "left" ? 1 : -1));
      }}
      onPointerUp={() => { panelDrag.current = null; }}
      onPointerCancel={() => { panelDrag.current = null; }}
    />;
  }

  function trackCursor(event) {
    const bounds = gridRef.current.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) {
      setCursorPixel(null);
      return;
    }
    const index = pixelAtPointer(event);
    const x = index % width + 1, y = Math.floor(index / width) + 1;
    setCursorPixel((previous) => previous?.x === x && previous?.y === y ? previous : { x, y });
  }

  function documentSnapshot() {
    return { width, height, frames, activeFrame, activeLayer, selection, floating: floating ? clone(floating) : null };
  }

  function rememberDocument() {
    const cells = frames.reduce((total, frame) => total + frame.layers.length * width * height, 0);
    const limit = Math.max(1, Math.min(HISTORY_LIMIT, Math.floor(HISTORY_PIXELS / cells)));
    setHistory((items) => [...items, documentSnapshot()].slice(-limit));
    setFuture([]);
  }

  function restoreDocument(document) {
    setWidth(document.width);
    setHeight(document.height);
    setFrames(document.frames);
    setActiveFrame(document.activeFrame);
    setActiveLayer(document.activeLayer);
    setSelection(document.selection || null);
    setFloating(document.floating || null);
    setPlaying(false);
  }

  function undo() {
    if (!history.length) return;
    const previous = history.at(-1);
    setFuture((items) => [documentSnapshot(), ...items]);
    setHistory((items) => items.slice(0, -1));
    restoreDocument(previous);
  }

  function redo() {
    if (!future.length) return;
    const next = future[0];
    setHistory((items) => [...items, documentSnapshot()]);
    setFuture((items) => items.slice(1));
    restoreDocument(next);
  }

  function copySelection() {
    if (!selection) return;
    setClipboard(copyPixels(currentLayer.pixels, selection, width));
    setExportStatus(`${selection.width} × ${selection.height} selection copied.`);
  }

  function pasteSelection() {
    if (currentLayer.locked) { setExportStatus("Unlock this layer before editing it."); return; }
    if (!clipboard) return;
    rememberDocument();
    const targetX = selection?.x ?? 0;
    const targetY = selection?.y ?? 0;
    const base = [...currentLayer.pixels];
    const result = placeFloating(base, clipboard, targetX, targetY, width, height);
    setFloating({ base, clip: clone(clipboard) });
    updateLayerPixels(() => result.pixels);
    setSelection(result.selection);
    setActiveTool("move");
  }

  function floatingSelection() {
    if (floating) return floating;
    const clip = copyPixels(currentLayer.pixels, selection, width);
    const base = currentLayer.pixels.map((color, index) => selectionContains(selection, index, width) ? null : color);
    return { base, clip };
  }
  function moveSelection(deltaX, deltaY) {
    if (currentLayer.locked) { setExportStatus("Unlock this layer before editing it."); return; }
    if (!selection || (!deltaX && !deltaY)) return;
    const item = floatingSelection();
    const result = placeFloating(item.base, item.clip, selection.x + deltaX, selection.y + deltaY, width, height);
    if (result.selection.x === selection.x && result.selection.y === selection.y) return;
    rememberDocument();
    setFloating(item);
    updateLayerPixels(() => result.pixels);
    setSelection(result.selection);
  }

  function clearSelectionPixels() {
    if (currentLayer.locked) { setExportStatus("Unlock this layer before editing it."); return; }
    if (!selection) return;
    rememberDocument();
    setFloating(null);
    updateLayerPixels((pixels) => floating ? [...floating.base] :
      pixels.map((color, index) => selectionContains(selection, index, width) ? null : color));
  }

  function updateLayerPixels(updater) {
    setFrames((items) => items.map((frame, frameIndex) => frameIndex !== activeFrame ? frame : {
      ...frame,
      layers: frame.layers.map((layer, layerIndex) => layerIndex !== activeLayer ? layer :
        { ...layer, pixels: updater(layer.pixels) }),
    }));
  }

  function paintedIndices(indices) {
    const expanded = new Set();
    indices.forEach((index) => brushIndices(index, width, height, brushSize, mirrorX, mirrorY)
      .forEach((paintIndex) => expanded.add(paintIndex)));
    return [...expanded];
  }

  function paint(indices, erase = false) {
    const color = erase ? null : selectedColor;
    if (currentLayer.locked) return;
    const touched = paintedIndices(indices).filter((index) => activeTool !== "dither" || ditherAccept(index, width, ditherDensity));
    const action = gesture.current;
    if (action?.working) {
      touched.forEach((index) => { action.working[index] = color; });
      const layers = [...displayLayers.slice(0, -currentFrame.layers.length), ...currentFrame.layers.map((layer) => layer.id === currentLayer.id ? { ...layer, pixels: action.working } : layer)];
      surfaceRef.current?.paint(touched, layers);
      return;
    }
    updateLayerPixels((pixels) => { const updated = [...pixels]; touched.forEach((index) => { updated[index] = color; }); return updated; });
  }

  function applyTool(index) {
    if (activeTool === "picker") {
      setSelectedColor(rgbaHex(compositeRgba(currentFrame.layers, index)));
      setActiveTool("pencil");
    } else if (activeTool === "fill") {
      updateLayerPixels((pixels) => fillArea(pixels, index, selectedColor, width, height));
    } else if (activeTool === "replace") {
      updateLayerPixels((pixels) => pixels.map((color) => color === pixels[index] ? selectedColor : color));
    } else if (activeTool === "pencil" || activeTool === "eraser" || activeTool === "dither") {
      paint([index], activeTool === "eraser");
    }
  }

  function pixelAtPointer(event) {
    const grid = gridRef.current;
    const bounds = grid.getBoundingClientRect();
    // Work in canvas coordinates, including when pointer capture carries us outside it.
    return pointerPixel(event.clientX, event.clientY, {
      left: bounds.left + grid.clientLeft, top: bounds.top + grid.clientTop,
      width: grid.clientWidth, height: grid.clientHeight,
    }, width, height);
  }

  function startDrawing(index, event) {
    if (event.button !== 0 || !loaded || !currentLayer?.visible || pinch.current) return;
    if (currentLayer.locked && activeTool !== "picker") { setExportStatus("Unlock this layer before editing it."); return; }
    event.preventDefault();
    if (activeTool === "picker") return applyTool(index);
    const moving = ["select", "move"].includes(activeTool) && selectionContains(selection, index, width);
    const selecting = ["select", "move"].includes(activeTool) && !moving;
    gesture.current = { start: index, last: index, tool: moving ? "move" : selecting ? "select" : activeTool,
      working: ["pencil", "eraser", "dither", "line", "rectangle", "ellipse"].includes(activeTool) ? [...currentLayer.pixels] : null, selection, floating: moving ? floatingSelection() : null, snapshot: documentSnapshot() };
    shapeStart.current = index;
    if (["line", "rectangle", "ellipse"].includes(activeTool)) setShapePreview(paintedIndices([index]));
    if (selecting) { setFloating(null); setSelection(selectionFromIndices(index, index, width)); }
    else rememberDocument();
    if (["pencil", "eraser", "dither", "fill", "replace"].includes(activeTool)) applyTool(index);
    setIsDrawing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueDrawing(event) {
    const action = gesture.current;
    if (!action) return;
    const index = pixelAtPointer(event);
    if (["pencil", "eraser", "dither"].includes(action.tool)) paint(lineIndices(action.last, index, width), action.tool === "eraser");
    if (action.tool === "select") setSelection(selectionFromIndices(action.start, index, width));
    if (action.tool === "move") {
      const result = placeFloating(action.floating.base, action.floating.clip,
        action.selection.x + index % width - action.start % width, action.selection.y + Math.floor(index / width) - Math.floor(action.start / width), width, height);
      setFloating(action.floating);
      updateLayerPixels(() => result.pixels);
      setSelection(result.selection);
    }
    if (["line", "rectangle", "ellipse"].includes(action.tool)) {
      const indices = action.tool === "line" ? lineIndices(action.start, index, width) :
        action.tool === "rectangle" ? rectangleIndices(action.start, index, width) : ellipseIndices(action.start, index, width);
      setShapePreview(paintedIndices(indices));
    }
    action.last = index;
  }

  function stopDrawing(event) {
    const action = gesture.current;
    if (!action) return;
    continueDrawing(event);
    const end = pixelAtPointer(event);
    if (["line", "rectangle", "ellipse"].includes(action.tool)) {
      const indices = action.tool === "line" ? lineIndices(action.start, end, width) :
        action.tool === "rectangle" ? rectangleIndices(action.start, end, width) : ellipseIndices(action.start, end, width);
      paint(indices);
    }
    if (action.working) updateLayerPixels(() => action.working);
    setShapePreview([]);
    gesture.current = null;
    shapeStart.current = null;
    setIsDrawing(false);
  }

  function cancelDrawing() {
    const action = gesture.current;
    if (action) {
      surfaceRef.current?.restore();
      restoreDocument(action.snapshot);
      if (action.tool !== "select") setHistory((items) => items.slice(0, -1));
    }
    setShapePreview([]);
    gesture.current = null;
    shapeStart.current = null;
    setIsDrawing(false);
  }

  function resizeDocument(nextWidth, nextHeight) {
    if (requiredSize) return;
    if (competition && !allowsCanvas(rules, nextWidth, nextHeight)) { setExportStatus(`Allowed: ${describeCanvas(competition)}.`); return; }
    if (competition && nextWidth * nextHeight * (animationDisabled ? 1 : frames.length) > 4194304) { setExportStatus("Reduce the frame count first: competitions allow up to 4,194,304 submitted pixels total."); return; }
    if (frames.some((frame) => frame.layers.some((layer) => layer.locked))) { setExportStatus("Unlock layers before resizing their pixels."); return; }
    const layerCount = frames.reduce((total, frame) => total + frame.layers.length, 0);
    if (!Number.isInteger(nextWidth) || !Number.isInteger(nextHeight) || nextWidth > 4096 || nextHeight > 4096 || nextWidth * nextHeight > MAX_PIXELS || nextWidth * nextHeight * layerCount > MAX_DOCUMENT_PIXELS || nextWidth < 1 || nextHeight < 1) {
      setExportStatus("Choose up to 1,048,576 pixels per canvas, 4096px per side, and 16,777,216 across layers/frames in this editor.");
      return;
    }
    rememberDocument();
    setFrames(resizeFrames(frames, width, height, nextWidth, nextHeight));
    setWidth(nextWidth);
    setHeight(nextHeight);
    commitSelection();
    setExportScale(nextWidth * nextHeight >= 262144 ? 1 : exportScale);
    setExportStatus(`Canvas resized to ${nextWidth} × ${nextHeight}.`);
  }

  function addLayer() {
    if (!canAddPixels(width * height)) return;
    rememberDocument();
    const nextLayer = makeLayer(width, height, nextLayerName(currentFrame.layers));
    commitSelection();
    setFrames((items) => items.map((frame, index) => index === activeFrame ? { ...frame, layers: [...frame.layers, nextLayer] } : frame));
    setActiveLayer(currentFrame.layers.length);
  }

  function duplicateLayer(layerIndex = activeLayer) {
    if (!canAddPixels(width * height)) return;
    rememberDocument();
    commitSelection();
    const source = currentFrame.layers[layerIndex];
    const copy = { ...clone(source), id: crypto.randomUUID(), name: `${source.name} copy`, locked: false };
    setFrames((items) => items.map((frame, index) => index === activeFrame ? {
      ...frame, layers: [...frame.layers.slice(0, layerIndex + 1), copy, ...frame.layers.slice(layerIndex + 1)],
    } : frame));
    setActiveLayer(layerIndex + 1);
  }

  function deleteLayer(layerIndex = activeLayer) {
    if (currentFrame.layers[layerIndex].locked) return;
    if (currentFrame.layers.length === 1) return;
    rememberDocument();
    setFrames((items) => items.map((frame, index) => index === activeFrame ? {
      ...frame, layers: renumberLayers(frame.layers.filter((_layer, index) => index !== layerIndex)),
    } : frame));
    setActiveLayer((selected) => selected > layerIndex ? selected - 1 : selected === layerIndex ? Math.max(0, layerIndex - 1) : selected);
    commitSelection();
  }

  function updateLayerAt(layerIndex, changes, remember = true) {
    if (remember) rememberDocument();
    setFrames((items) => items.map((frame, index) => index === activeFrame ? {
      ...frame, layers: frame.layers.map((layer, index) => index === layerIndex ? { ...layer, ...changes } : layer),
    } : frame));
  }

  function updateLayer(changes, remember = true) {
    updateLayerAt(activeLayer, changes, remember);
  }

  function moveLayerTo(from, target) {
    if (from === target || target < 0 || target >= currentFrame.layers.length) return;
    rememberDocument();
    const selectedId = currentLayer.id;
    const layers = reorderLayers(currentFrame.layers, from, target);
    setFrames((items) => items.map((frame, index) => index === activeFrame ? { ...frame, layers } : frame));
    setActiveLayer(layers.findIndex((layer) => layer.id === selectedId));
    commitSelection();
  }

  function addFrame(copyCurrent = false) {
    if (animationDisabled) { setExportStatus("Animation is disabled in this competition."); return; }
    if (competition && (frames.length >= 32 || (frames.length + 1) * width * height > 4194304)) { setExportStatus("Competition animation limit reached."); return; }
    if (!canAddPixels(width * height * currentFrame.layers.length)) return;
    rememberDocument();
    const frame = copyCurrent ? { ...clone(currentFrame), id: crypto.randomUUID() } : makeFrame(width, height,
      currentFrame.layers.map((layer) => ({ ...makeLayer(width, height, layer.name), customName: layer.customName })));
    const nextIndex = activeFrame + 1;
    setFrames((items) => [...items.slice(0, nextIndex), frame, ...items.slice(nextIndex)]);
    setActiveFrame(nextIndex);
    setActiveLayer(0);
    setPreviewFrame(nextIndex);
    commitSelection();
  }

  function moveFrame(direction) {
    const target = activeFrame + direction;
    if (target < 0 || target >= frames.length) return;
    rememberDocument();
    setFrames((items) => {
      const reordered = [...items];
      [reordered[activeFrame], reordered[target]] = [reordered[target], reordered[activeFrame]];
      return reordered;
    });
    setActiveFrame(target);
    setPreviewFrame(target);
  }

  function deleteFrame() {
    if (frames.length === 1) return;
    rememberDocument();
    const nextIndex = Math.max(0, activeFrame - 1);
    setFrames((items) => items.filter((_frame, index) => index !== activeFrame));
    setActiveFrame(nextIndex);
    setActiveLayer(0);
    setPreviewFrame(nextIndex);
    commitSelection();
  }

  function clearLayer() {
    if (currentLayer.locked) { setExportStatus("Unlock this layer before editing it."); return; }
    if (currentLayer.pixels.every((color) => color === null)) return;
    rememberDocument();
    updateLayerPixels(() => Array(width * height).fill(null));
  }

  function drawFrameToCanvas(context, frame, offsetX, scale) {
    context.clearRect(offsetX, 0, width * scale, height * scale);
    for (const layer of frame.layers) {
      if (!layer.visible) continue;
      context.globalAlpha = layer.opacity;
      layer.pixels.forEach((color, index) => {
        if (!color) return;
        context.fillStyle = color;
        context.fillRect(offsetX + (index % width) * scale, Math.floor(index / width) * scale, scale, scale);
      });
    }
    context.globalAlpha = 1;
  }

  function canAddPixels(extra) {
    const total = frames.reduce((sum, frame) => sum + frame.layers.length * width * height, extra);
    if (total <= MAX_DOCUMENT_PIXELS) return true;
    setExportStatus("This editor supports 16,777,216 pixels across all layers and frames. Use fewer layers/frames or a smaller canvas.");
    return false;
  }

  function downloadImage(allFrames = false) {
    try {
      const chosenFrames = allFrames ? frames : [currentFrame];
      if (width * height * exportScale * exportScale * chosenFrames.length > 16777216) {
        setExportStatus("Export is too large. Choose a lower export scale (1× for large canvases).");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width * exportScale * chosenFrames.length;
      canvas.height = height * exportScale;
      const context = canvas.getContext("2d");
      chosenFrames.forEach((frame, index) => drawFrameToCanvas(context, frame, index * width * exportScale, exportScale));
      const link = document.createElement("a");
      link.download = allFrames ? `sprite-sheet-${width}x${height}-${frames.length}-frames.png` : `pixel-art-${width}x${height}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      setExportStatus(allFrames ? "Sprite sheet downloaded." : "PNG downloaded.");
    } catch {
      setExportStatus("Could not export the image. Please try again.");
    }
  }

  function downloadGif() {
    try {
      const gif = GIFEncoder();
      frames.forEach((frame) => {
        const colors = flattenFrame(frame);
        const rgba = new Uint8Array(colors.length * 4);
        colors.forEach((color, index) => {
          rgba[index * 4] = Number.parseInt(color.slice(1, 3), 16);
          rgba[index * 4 + 1] = Number.parseInt(color.slice(3, 5), 16);
          rgba[index * 4 + 2] = Number.parseInt(color.slice(5, 7), 16);
          rgba[index * 4 + 3] = 255;
        });
        const gifPalette = quantize(rgba, 256);
        gif.writeFrame(applyPalette(rgba, gifPalette), width, height, {
          palette: gifPalette, delay: Math.round(1000 / fps), repeat: 0,
        });
      });
      gif.finish();
      const url = URL.createObjectURL(new Blob([gif.bytesView()], { type: "image/gif" }));
      const link = document.createElement("a");
      link.download = `pixel-animation-${width}x${height}-${frames.length}-frames.gif`;
      link.href = url;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus("Animated GIF downloaded.");
    } catch {
      setExportStatus("Could not export the GIF. Your frames are still safe.");
    }
  }

  const preview = frames[playing ? Math.min(previewFrame, frames.length - 1) : activeFrame];
  const availablePresets = competition && rules.mode !== "range" ? rules.sizes.map((size) => [size, size]) : PRESETS.filter(([w, h]) => !competition || allowsCanvas(rules, w, h));
  const presetValue = availablePresets.some(([w, h]) => w === width && h === height) ? `${width}x${height}` : "custom";

  return <section className="editor advanced-editor lab-editor" data-theme={theme} style={{ "--checker-a": checkerA, "--checker-b": checkerB }} aria-label="Pixel art editor">
    <div className="editor-bar">
      <div>{editingTitle ? <input className="artwork-title-input" aria-label="Artwork title" autoFocus maxLength={80} defaultValue={artworkTitle}
        onBlur={(event) => { setArtworkTitle(event.target.value.trim() || "Untitled artwork"); setEditingTitle(false); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { event.currentTarget.value = artworkTitle; event.currentTarget.blur(); }
        }} /> : <button type="button" className="document-label artwork-title-button" title="Click to rename artwork" onClick={() => setEditingTitle(true)}>{artworkTitle} <span aria-hidden="true">✎</span></button>}
        <span className="document-size">Autosaved on this device</span></div>
      <div ref={menusRef} className="lab-menus">
        <details className="lab-menu" {...menuProps()}><summary>Canvas ▾</summary><fieldset className="document-controls" disabled={!loaded}>      <label>Canvas preset<select value={requiredSize ? `${requiredSize}x${requiredSize}` : presetValue} disabled={Boolean(requiredSize)} onChange={(event) => {
        if (event.target.value === "custom") return;
        const [nextWidth, nextHeight] = event.target.value.split("x").map(Number);
        resizeDocument(nextWidth, nextHeight);
      }}>{["Square", "Portrait", "Landscape"].map((group) => <optgroup key={group} label={group}>{availablePresets.filter(([w, h]) => group === "Square" ? w === h : group === "Portrait" ? w < h : w > h).sort((a, b) => a[0] * a[1] - b[0] * b[1]).map(([w, h]) => <option key={`${w}x${h}`} value={`${w}x${h}`}>{w} × {h}</option>)}</optgroup>)}
        {!requiredSize && <option value="custom">Custom size</option>}</select></label>
      {!requiredSize && <form className="custom-size" key={`${width}x${height}`} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        resizeDocument(Number(data.get("width")), Number(data.get("height")));
      }}><label>Width<input name="width" type="number" min="1" max="4096" defaultValue={width} /></label><span>×</span>
        <label>Height<input name="height" type="number" min="1" max="4096" defaultValue={height} /></label><button>Apply</button></form>}
      {competition && <span className="resize-note">{describeCanvas(competition)} · {animationDisabled ? "Still artwork only" : competition.animation_mode === "required" ? "Animation required" : "Animation optional"}</span>}
</fieldset></details>
        <details className="lab-menu" {...menuProps()}><summary>Download ▾</summary><fieldset className="document-controls" disabled={!loaded}>      <label>Export scale<select value={exportScale} onChange={(event) => setExportScale(Number(event.target.value))}>{[1, 4, 8, 16].map((scale) => <option key={scale} value={scale}>{scale}×</option>)}</select></label>
      <button type="button" className="download-button" onClick={() => { downloadImage(false); closeMenus(); }}>PNG</button>
      {frames.length > 1 && <button type="button" className="download-button sprite-button" onClick={() => { downloadImage(true); closeMenus(); }}>Sprite sheet</button>}
      {frames.length > 1 && <button type="button" className="download-button gif-button" onClick={() => { downloadGif(); closeMenus(); }}>Animated GIF</button>}</fieldset></details>
        <details className="lab-menu settings-menu view-menu" {...menuProps()}><summary>Settings ▾</summary><fieldset className="document-controls settings-grid" disabled={!loaded}>
          <section className="settings-section"><h3>Appearance</h3>
            <label>Website appearance<select aria-label="Website appearance" value={preference} onChange={(event) => setPreference(event.target.value)}><option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
            <label>Canvas background<select value={backgroundMode} onChange={(event) => setBackgroundMode(event.target.value)}><option value="checker">Checkerboard</option><option value="solid">Solid color</option></select></label>
            <div className="background-colors"><label>Color A<input type="color" value={checkerA} onChange={(event) => setCheckerA(event.target.value)} /></label>{backgroundMode === "checker" && <label>Color B<input type="color" value={checkerB} onChange={(event) => setCheckerB(event.target.value)} /></label>}</div>
            <small>Canvas background is display-only. Transparency stays intact on export.</small>
          </section>
          <section className="settings-section"><h3>Workspace</h3>
            <label className="compact-control">Canvas zoom<select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}><option value="0">Fit</option>{zoom > 0 && ![1, 2, 4, 8, 16, 32].includes(zoom) && <option value={zoom}>{Math.round(zoom * 100)}%</option>}{[1, 2, 4, 8, 16, 32].map((scale) => <option value={scale} key={scale}>{scale}×</option>)}</select></label>
            <label className="help-setting"><input type="checkbox" checked={resizablePanels} onChange={(event) => setResizablePanels(event.target.checked)} /> Resizable side panels</label>
            <small>Off keeps the current panel widths fixed.</small>
            <label className="help-setting"><input type="checkbox" checked={showCoordinates} onChange={(event) => setShowCoordinates(event.target.checked)} /> Show pixel coordinates</label>
            <label className="help-setting"><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} /> Show pixel grid</label>
            <button type="button" onClick={resetLayout}>Reset layout</button>
          </section>
          <section className="settings-section"><h3>Drawing &amp; help</h3>
            <label className="help-setting"><input type="checkbox" checked={universalSize} onChange={(event) => { setUniversalSize(event.target.checked); if (event.target.checked) { setPencilSize(brushSize); setEraserSize(brushSize); } }} /> Universal pixel size</label>
            <small>Off: brush and eraser remember separate sizes.</small>
            <label className="help-setting"><input type="checkbox" checked={eraserPreview} onChange={(event) => setEraserPreview(event.target.checked)} /> Eraser hover preview</label>
            <label className="help-setting"><input type="checkbox" checked={helpEnabled} onChange={(event) => { setHelpEnabled(event.target.checked); hideToolHint(); }} /> Tool explanations</label>
            <small>Longer hover explanations. Quick names and shortcuts remain available.</small>
          </section>
          <section className="settings-section"><h3>Menus &amp; reset</h3>
            <label className="help-setting"><input type="checkbox" checked={autoCloseMenus} onChange={(event) => { setAutoCloseMenus(event.target.checked); cancelMenuFade(); }} /> Auto-close menus</label>
            <small>Fade and close when you move away. Outside click and Escape always close menus.</small>
            <button type="button" onClick={resetViewPreferences}>Reset editor preferences</button>
            <small>Restores editor defaults without deleting artwork or colors. Website appearance is unchanged.</small>
          </section>
        </fieldset></details>
      </div>
      <div className="history-controls" aria-label="Canvas history">
        <button type="button" onClick={undo} disabled={!history.length} title="Undo (Ctrl / Cmd Z)"><span aria-hidden="true">↶</span> Undo</button>
        <button type="button" onClick={redo} disabled={!future.length} title="Redo (Ctrl / Cmd Shift Z, or Ctrl Y)"><span aria-hidden="true">↷</span> Redo</button>
      </div>
    </div>


    <fieldset ref={workspaceRef} className="workspace" disabled={!loaded} style={{ "--left-panel-width": `${leftWidth}px`, "--right-panel-width": `${rightWidth}px` }}>
      <aside className="tool-panel" aria-label="Drawing tools">
        <p className="panel-title">Tools</p><div className="tool-list">{TOOLS.map((tool) => <button key={tool.id} type="button"
          className={`tool-button ${activeTool === tool.id ? "active" : ""}`} onClick={() => chooseDrawingTool(tool.id)} aria-pressed={activeTool === tool.id} aria-label={tool.label} data-tooltip={`${tool.label} · ${tool.shortcut}`} data-expanded-help={toolHint?.label === tool.label ? "true" : "false"} {...helpProps(tool.label, TOOL_HELP[tool.id])}>
          <span className="tool-icon" aria-hidden="true">{tool.icon}</span><span>{tool.label}</span><kbd>{tool.shortcut}</kbd></button>)}</div>
        <div className="panel-divider" />
        <label className="compact-control brush-slider">{activeTool === "eraser" ? "Eraser" : "Brush"} · {brushSize}px<input type="range" aria-label="Brush / eraser size" min="1" max="32" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
        {activeTool === "dither" && <label className="compact-control">Dither density<select value={ditherDensity} onChange={(event) => setDitherDensity(Number(event.target.value))}>{[25, 50, 75].map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>}
        <div className="selection-actions" aria-label="Selection actions">
          <button type="button" aria-label="Copy selection" title="Copy · Ctrl / Cmd C" onClick={copySelection} disabled={!selection}>⧉</button><button type="button" aria-label="Paste selection" title="Paste · Ctrl / Cmd V" onClick={pasteSelection} disabled={!clipboard}>▣</button>
          <button type="button" aria-label="Select all" title="Select all · Ctrl / Cmd A" onClick={selectAll}>⌗</button>
          <button type="button" aria-label="Deselect" title="Deselect · Esc" onClick={commitSelection} disabled={!selection}>×</button>
          <button type="button" aria-label="Cut selection" title="Cut · Ctrl / Cmd X" onClick={() => { copySelection(); clearSelectionPixels(); }} disabled={!selection}>✂</button><button type="button" aria-label="Clear selection" title="Clear selected pixels · Delete" onClick={clearSelectionPixels} disabled={!selection}>⌫</button>
        </div><div className="selection-actions selection-nudges" aria-label="Nudge selection">
          <button type="button" onClick={() => moveSelection(-1, 0)} disabled={!selection} aria-label="Move selection left">←</button><button type="button" onClick={() => moveSelection(0, -1)} disabled={!selection} aria-label="Move selection up">↑</button>
          <button type="button" onClick={() => moveSelection(0, 1)} disabled={!selection} aria-label="Move selection down">↓</button><button type="button" onClick={() => moveSelection(1, 0)} disabled={!selection} aria-label="Move selection right">→</button>
        </div>
        <button type="button" className="grid-toggle" onClick={() => setMirrorX((value) => !value)} aria-pressed={mirrorX}><span>↔</span> Mirror X<span className={`switch ${mirrorX ? "on" : ""}`} /></button>
        <button type="button" className="grid-toggle" onClick={() => setMirrorY((value) => !value)} aria-pressed={mirrorY}><span>↕</span> Mirror Y<span className={`switch ${mirrorY ? "on" : ""}`} /></button>
        <button type="button" className="grid-toggle" onClick={() => setShowGrid((value) => !value)} aria-pressed={showGrid}><span className="mini-grid" /> Grid<span className={`switch ${showGrid ? "on" : ""}`} /></button>
        <button type="button" className="grid-toggle" onClick={() => setOnionSkin((value) => !value)} aria-pressed={onionSkin} disabled={activeFrame === 0}><span>◫</span> Onion skin<span className={`switch ${onionSkin ? "on" : ""}`} /></button>
        <button type="button" className="shortcut-launcher" onClick={() => shortcutsRef.current.showModal()}>⌨ Shortcuts</button>
      </aside>

      {panelHandle("left")}
      <div className="canvas-stage">
        <div ref={viewportRef} className={`canvas-viewport ${zoom ? "zoomed" : ""}`} onPointerDownCapture={touchDown} onPointerMoveCapture={touchMove} onPointerUpCapture={touchUp} onPointerCancelCapture={touchUp}>
          <div ref={gridRef} className={`pixel-grid ${showGrid ? "" : "grid-hidden"}`} style={{ gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${height}, minmax(0, 1fr))`, aspectRatio: `${width} / ${height}`, "--canvas-ratio": width / height, ...(backgroundMode === "solid" ? { backgroundImage: "none", backgroundColor: checkerA } : {}), ...(zoom ? { width: width * zoom, height: height * zoom, position: "relative", top: 0, left: 0, transform: "none" } : {}) }}
            onPointerDown={(event) => startDrawing(pixelAtPointer(event), event)}
            onPointerMove={(event) => { trackCursor(event); continueDrawing(event); }} onPointerLeave={() => setCursorPixel(null)} onPointerUp={stopDrawing} onPointerCancel={cancelDrawing} role="img" aria-label={`${width} by ${height} interactive pixel canvas`}>
            <RasterSurface surfaceRef={surfaceRef} layers={displayLayers} width={width} height={height} label={`${width} by ${height} artwork`} />
            {eraserPreview && cursorPixel && activeTool === "eraser" && !currentLayer.locked && <div className="eraser-preview" aria-label="Eraser footprint">{brushFootprints((cursorPixel.y - 1) * width + cursorPixel.x - 1, width, height, eraserSize, mirrorX, mirrorY).map((box, index) => <span key={index} style={{ left: `${box.x / width * 100}%`, top: `${box.y / height * 100}%`, width: `${box.width / width * 100}%`, height: `${box.height / height * 100}%` }} />)}</div>}
            {shapePreview.length > 0 && <ShapePreview indices={shapePreview} width={width} height={height} color={selectedColor} />}
            {showGrid && (zoom >= 6 || (width <= 128 && height <= 128)) && <div className="raster-grid-lines" style={{ backgroundSize: `${100 / width}% ${100 / height}%` }} />}
            {selection && ["select", "move"].includes(activeTool) && <div className="selection-outline" style={{ left: `${selection.x / width * 100}%`, top: `${selection.y / height * 100}%`, width: `${selection.width / width * 100}%`, height: `${selection.height / height * 100}%` }} />}
          </div>
        </div>
        {showCoordinates && <output className="canvas-coordinates" aria-label="Mouse pixel coordinates" title="Pixel coordinates: X, Y. Top-left is 1, 1.">
          {cursorPixel ? `X ${cursorPixel.x}, Y ${cursorPixel.y}` : "X —, Y —"}
        </output>}
      </div>

      {panelHandle("right")}
      <aside className="color-panel" aria-label="Colors and layers">
        <p className="panel-title">Color</p><label className="color-control"><input type="color" value={selectedColor} onChange={(event) => setSelectedColor(event.target.value)} /><span><strong>Current</strong><code>{selectedColor.toUpperCase()}</code></span></label>
        <p className="panel-title palette-title">Palette · custom slots at the end</p>
        <div className="palette unified-palette">
          {DEFAULT_COLORS.map((color) => <button key={color} type="button" className={selectedColor === color ? "selected" : ""} style={{ backgroundColor: color }} onClick={() => setSelectedColor(color)} aria-label={`Use ${color}`} />)}
          {palette.map((color, index) => <button key={index} type="button" className={`custom-slot ${color ? "filled" : "empty"} ${selectedColor === color ? "selected" : ""}`}
            style={color ? { backgroundColor: color } : undefined} aria-label={color ? `Use custom color ${index + 1}` : `Set custom color ${index + 1}`}
            title="Click to use · double-click or right-click to edit"
            onClick={() => { if (color) setSelectedColor(color); else setEditingSlot(index); }}
            onDoubleClick={() => setEditingSlot(index)} onContextMenu={(event) => { event.preventDefault(); setEditingSlot(index); }}>{color ? "" : "+"}</button>)}
        </div>
        {editingSlot !== null && <div className="slot-editor">
          <label>Custom color {editingSlot + 1}<input type="color" aria-label="Custom slot color" value={palette[editingSlot] || selectedColor} onChange={(event) => {
            setPalette((items) => items.map((color, index) => index === editingSlot ? event.target.value : color));
            setSelectedColor(event.target.value);
          }} /></label>
          <button type="button" onClick={() => { setPalette((items) => items.map((color, index) => index === editingSlot ? selectedColor : color)); setEditingSlot(null); }}>Save color</button>
          <button type="button" onClick={() => { setPalette((items) => items.map((color, index) => index === editingSlot ? null : color)); setEditingSlot(null); }}>Empty slot</button>
        </div>}
        <div className="panel-divider" />
<section className="transform-panel" aria-label="Transforms"><p className="panel-title">Transform tools</p><small className="transform-caption">Selection or active layer</small>
        <div className="transform-actions" aria-label="Transform selection or active layer">
          <button type="button" aria-label="Flip horizontally" data-tooltip="Flip horizontally" {...helpProps("Flip horizontally", "Mirror the selection or entire active layer from left to right.")} onClick={() => transformArtwork("flipX")}>↔</button>
          <button type="button" aria-label="Flip vertically" data-tooltip="Flip vertically" {...helpProps("Flip vertically", "Mirror the selection or entire active layer from top to bottom.")} onClick={() => transformArtwork("flipY")}>↕</button>
          <button type="button" aria-label="Rotate clockwise" data-tooltip="Rotate 90°" {...helpProps("Rotate clockwise", "Rotate the selection or active layer 90°. If it will not fit, resize first; pixels are never silently cropped.")} onClick={() => transformArtwork("rotate")}>⟳</button>
          <button type="button" aria-label="Invert colors" data-tooltip="Invert colors" {...helpProps("Invert colors", "Swap each painted color with its RGB opposite in the selection or active layer. Transparent pixels stay transparent.")} onClick={invertArtwork}>◐</button>
        </div>
</section>
        <div className="lab-tabs" role="group" aria-label="Sidebar panel"><button type="button" aria-pressed={panel === "layers"} onClick={() => setPanel("layers")}>Layers</button><button type="button" aria-pressed={panel === "animation"} disabled={animationDisabled} onClick={() => setPanel("animation")}>Animation</button></div>
        {panel === "animation" && <section className="compact-frame-workspace" aria-label="Animation frames">
          <div className="frames-heading"><div><p className="panel-title">Frames</p><span>{frames.length}</span></div><label>FPS<select value={fps} onChange={(event) => setFps(Number(event.target.value))}>{[2, 4, 6, 8, 12, 16, 24].map((value) => <option key={value}>{value}</option>)}</select></label></div>
          <div className="frame-quick-actions"><button type="button" onClick={() => addFrame(false)} disabled={animationDisabled} title="Add blank frame">＋</button><button type="button" onClick={() => addFrame(true)} disabled={animationDisabled} title="Duplicate frame">Duplicate</button><button type="button" onClick={() => moveFrame(-1)} disabled={activeFrame === 0} title="Move frame left">←</button><button type="button" onClick={() => moveFrame(1)} disabled={activeFrame === frames.length - 1} title="Move frame right">→</button><button type="button" onClick={deleteFrame} disabled={frames.length === 1} title="Delete frame">Delete</button><button type="button" onClick={() => { setPlaying((value) => !value); setPreviewFrame(activeFrame); }}>{playing ? "Pause" : "Play"}</button></div>
          <div className="frame-strip">{frames.map((frame, index) => <button type="button" key={frame.id} className={activeFrame === index ? "active" : ""} onClick={() => { setActiveFrame(index); setActiveLayer(0); setPreviewFrame(index); commitSelection(); }}>
            <FramePreview frame={frame} width={width} height={height} label={`Frame ${index + 1}`} /><span>{index + 1}</span></button>)}</div>
          <div className="animation-preview"><FramePreview frame={preview} width={width} height={height} label="Animation preview" /><span>{playing ? `${fps} FPS` : "Preview"}</span></div>
        </section>}
        <div className="panel-divider" />
        <section hidden={panel !== "layers"} aria-label="Layers in current frame"><p className="lab-help">Stacked artwork · Frame {activeFrame + 1}</p>
        <div className="layers-heading"><p className="panel-title">Layers</p><button type="button" onClick={addLayer} title="Add layer">＋</button></div>
        <div className="layer-list">{[...currentFrame.layers].reverse().map((layer, reverseIndex) => {
          const index = currentFrame.layers.length - 1 - reverseIndex;
          return <div key={layer.id} className={`layer-row ${activeLayer === index ? "active" : ""}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const from = currentFrame.layers.findIndex((item) => item.id === draggedLayer.current); if (from >= 0) moveLayerTo(from, index); draggedLayer.current = null; }}>
            <div className="layer-row-heading">
            <span className="layer-grip" draggable title="Drag to reorder layer" aria-label={`Drag ${layer.name}`} onDragStart={(event) => { draggedLayer.current = layer.id; event.dataTransfer.setData("text/plain", layer.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { draggedLayer.current = null; }}>⠿</span>
            <button type="button" className="layer-visibility" aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`} title={layer.visible ? "Hide layer" : "Show layer"} aria-pressed={layer.visible} onClick={() => updateLayerAt(index, { visible: !layer.visible })}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12" r="3" fill="currentColor" />{!layer.visible && <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2.5" />}</svg></button>
            {editingLayer?.id === layer.id ? <input autoFocus aria-label="Rename layer" maxLength={30} defaultValue={layer.name}
              onBlur={(event) => renameLayer(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") { renameCancelled.current = true; event.currentTarget.blur(); }
              }} /> : <button type="button" className="layer-name" title="Double-click to rename · F2 also works"
              onClick={() => { setActiveLayer(index); commitSelection(); }}
              onDoubleClick={() => { renameCancelled.current = false; setEditingLayer({ id: layer.id, name: layer.name }); }}
              onKeyDown={(event) => { if (event.key === "F2") { event.preventDefault(); renameCancelled.current = false; setEditingLayer({ id: layer.id, name: layer.name }); } }}>{layer.name}</button>}
            <button type="button" className="layer-lock" aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`} title={layer.locked ? "Unlock layer" : "Lock layer"} aria-pressed={Boolean(layer.locked)} onClick={() => { commitSelection(); updateLayerAt(index, { locked: !layer.locked }); }}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" fill={layer.locked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" /><path d={layer.locked ? "M8 10V7a4 4 0 0 1 8 0v3" : "M8 10V7a4 4 0 0 1 8 0"} fill="none" stroke="currentColor" strokeWidth="1.7" /></svg></button>
            </div>
            <div className="layer-row-actions"><small>{Math.round(layer.opacity * 100)}%</small>
            <button type="button" aria-label={`Move ${layer.name} up`} title="Move up" disabled={index === currentFrame.layers.length - 1} onClick={() => moveLayerTo(index, index + 1)}>↑</button>
            <button type="button" aria-label={`Move ${layer.name} down`} title="Move down" disabled={index === 0} onClick={() => moveLayerTo(index, index - 1)}>↓</button>
            <button type="button" aria-label={`Duplicate ${layer.name}`} title="Duplicate layer" onClick={() => duplicateLayer(index)}>⧉</button>
            <button type="button" aria-label={`Delete ${layer.name}`} title="Delete layer" disabled={layer.locked || currentFrame.layers.length === 1} onClick={() => deleteLayer(index)}><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button></div>
          </div>;
        })}</div>
        <label className="compact-control">Layer opacity<input disabled={currentLayer.locked} type="range" min="0" max="100" value={Math.round(currentLayer.opacity * 100)} onPointerDown={() => rememberDocument()} onChange={(event) => updateLayer({ opacity: Number(event.target.value) / 100 }, false)} /></label>

        <button type="button" className="clear-button" disabled={currentLayer.locked} onClick={clearLayer}>Clear active layer</button>
        </section>
      </aside>
    </fieldset>

    {helpEnabled && toolHint && <aside id="lab-tool-help" className="tool-explanation" role="tooltip" style={{ left: toolHint.left, top: toolHint.top }}><strong>{toolHint.label}</strong><p>{toolHint.description}</p></aside>}
    <dialog ref={shortcutsRef} className="shortcuts-dialog" aria-label="Keyboard shortcuts" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="shortcut-sheet"><header><h2>Keyboard shortcuts</h2><button type="button" aria-label="Close shortcuts" onClick={() => shortcutsRef.current.close()}>×</button></header>
      <p>Use Cmd on Mac or Ctrl on Windows/Linux. Copy/paste works inside this editor.</p>
      <div className="shortcut-rows">{[["Undo", ["Ctrl / Cmd", "Z"]], ["Redo", ["Ctrl / Cmd", "Shift", "Z"]], ["Copy", ["Ctrl / Cmd", "C"]], ["Cut", ["Ctrl / Cmd", "X"]], ["Paste", ["Ctrl / Cmd", "V"]], ["Select all", ["Ctrl / Cmd", "A"]], ["Move selection", ["←", "↑", "↓", "→"]], ["Deselect", ["Esc"]], ["Brush size", ["[", "]"]], ...TOOLS.map((tool) => [tool.label, [tool.shortcut]])].map(([label, keys]) => <div key={label}><span>{label}</span><span>{keys.map((key, index) => <span key={key}>{index > 0 && <i> + </i>}<kbd>{key}</kbd></span>)}</span></div>)}</div></div>
    </dialog>
    <div className="status-bar"><span><strong>{TOOLS.find((tool) => tool.id === activeTool)?.label}</strong> · {brushSize}px</span><span className="canvas-details">{width} × {height} · Frame {activeFrame + 1} · {currentLayer?.name}{selection && ["select", "move"].includes(activeTool) ? ` · Selection ${selection.width} × ${selection.height}` : ""}</span><span role="status">{saveStatus} {exportStatus}</span></div>
    {competition && <form className="submission-form" onSubmit={async (event) => {
      event.preventDefault();
      if (submitting) return;
      const data = new FormData(event.currentTarget);
      setSubmitting(true);
      try {
        const artwork = { size: width, height, pixels: flattenFrame(currentFrame), frames: animationDisabled ? [flattenFrame(currentFrame)] : frames.map((frame) => flattenFrame(frame)), fps };
        const invalid = validateCompetitionArtwork(competition, artwork);
        if (invalid) { setSubmissionMessage(invalid); return; }
        const error = await onSubmitArtwork(artwork, data.get("artist"), data.get("artworkTitle"));
        setSubmissionMessage(error || "Artwork submitted.");
      } catch { setSubmissionMessage("Could not submit. Your draft is still available."); }
      finally { setSubmitting(false); }
    }}><h3>Submit {animationDisabled ? `frame ${activeFrame + 1}` : `${frames.length} frame${frames.length === 1 ? "" : "s"}`} to {competition.title}</h3><p>{describeCanvas(competition)} · {competition.animation_mode === "required" ? "Animation required (at least 2 frames)" : animationDisabled ? "Still artwork" : "Still or animation"}. Layers are flattened; your editable draft stays here.</p>
      {competition.phase !== "submissions" ? <p>Submissions are closed for this event.</p> : <fieldset disabled={!loaded || submitting}>
        <label>Nickname<input name="artist" value={participantName} readOnly required maxLength={60} /></label><label>Artwork title (optional)<input name="artworkTitle" maxLength={80} placeholder="Untitled" defaultValue={artworkTitle === "Untitled artwork" ? "" : artworkTitle} /></label>
        <button className="download-button">{submitting ? "Submitting…" : "Submit artwork"}</button></fieldset>}<p role="status">{submissionMessage}</p></form>}
  </section>;
}
