export const STUDIO_PREFERENCES_KEY = "pixelsdraw:studio-preferences:v1";
export const DEFAULT_STUDIO_PREFERENCES = { workspaceMode: "simple", animateLogo: true };

export function studioPreferences(value) {
  return {
    workspaceMode: value?.workspaceMode === "advanced" ? "advanced" : "simple",
    animateLogo: typeof value?.animateLogo === "boolean" ? value.animateLogo : true,
  };
}

export function parseStudioPreferences(value) {
  try { return studioPreferences(JSON.parse(value)); }
  catch { return { ...DEFAULT_STUDIO_PREFERENCES }; }
}

// Clamp panels together after a window resize, reserving room for the canvas.
// Mobile uses its own stacked layout instead of these desktop columns.
export function workspacePanels(left, right, width) {
  const safeLeft = Math.round(Math.max(112, Math.min(320, Number.isFinite(left) ? left : 132)));
  const safeRight = Math.round(Math.max(190, Math.min(420, Number.isFinite(right) ? right : 234)));
  if (!Number.isFinite(width) || width <= 0) return { left: safeLeft, right: safeRight };
  const spare = Math.max(0, width - 254 - 112 - 190);
  const wanted = safeLeft - 112 + safeRight - 190;
  const ratio = wanted ? Math.min(1, spare / wanted) : 1;
  return { left: 112 + Math.floor((safeLeft - 112) * ratio), right: 190 + Math.floor((safeRight - 190) * ratio) };
}

export function editorMenuPosition(anchor, popupWidth, popupHeight, viewportWidth, viewportHeight) {
  const width = Math.min(popupWidth, Math.max(0, viewportWidth - 24));
  const left = Math.max(12, Math.min(viewportWidth - width - 12, anchor.right - width));
  const below = viewportHeight - anchor.bottom - 20;
  const top = below >= 160 ? anchor.bottom + 8 : Math.max(12, anchor.top - popupHeight - 8);
  return { left, top, maxHeight: Math.max(40, viewportHeight - top - 12) };
}
