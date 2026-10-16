// Keep main, lab and competition drafts separate. Old keys remain untouched as backups.
export function editorDraftKeys(competitionId = null, scope = "main", owner = null) {
  if (/^drawing:[a-z0-9-]+$/i.test(scope)) return { primary: `pixelsdraw:${scope}`, legacy: `pixelsdraw:${scope}`, labFallback: null };
  const suffix = competitionId ? `:competition:${competitionId}` : "";
  if (owner) {
    const key = `pixelsdraw:draft:v4:${encodeURIComponent(owner)}:${scope}${suffix}`;
    // Old browser-wide drafts have no reliable owner. Never import them silently.
    return { primary: key, legacy: key, labFallback: null };
  }
  return {
    primary: `${scope === "lab" ? "pixel-art-studio:lab:draft:v1" : "pixel-art-studio:draft:v3"}${suffix}`,
    legacy: `pixel-art-studio:draft:v2${suffix}`,
    labFallback: scope === "main" && !competitionId ? "pixel-art-studio:lab:draft:v1" : null,
  };
}

// IndexedDB stores larger editable drafts without localStorage's small quota.
export function openDraftDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pixel-art-editor-lab", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readLabDraft(key) {
  const database = await openDraftDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

export async function saveLabDraft(key, document) {
  const database = await openDraftDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").put(document, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}
