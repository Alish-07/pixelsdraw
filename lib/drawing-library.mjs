import { editorDraftKeys, openDraftDatabase, readLabDraft } from "./editor-lab-storage.mjs";

export function libraryOwner(user) { return user && !user.is_anonymous ? user.id : "device"; }
export function drawingKey(id) {
  if (!/^[a-z0-9-]{1,80}$/i.test(id)) throw new Error("Invalid drawing ID");
  return editorDraftKeys(null, `drawing:${id}`).primary;
}
const indexKey = owner => `pixelsdraw:library:v1:${owner}`;

export function drawingName(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function planDrawingSave(entries, document, { newId, replaceId } = {}) {
  const title = String(document.artworkTitle || "").trim().slice(0, 80) || "Untitled artwork";
  const matches = entries.filter(entry => !entry.deletedAt && drawingName(entry.title) === drawingName(title));
  const replacement = matches.find(entry => entry.id === replaceId);
  if (matches.length && !replacement) return { status: "conflict", existing: matches[0] };
  const entry = { id: replacement?.id || newId, title, width: document.width, height: document.height, savedAt: new Date().toISOString() };
  return { status: "saved", entry, entries: [entry, ...entries.filter(item => item.id !== entry.id)] };
}

export async function listDrawings(owner, trash = false) {
  const items = await readLabDraft(indexKey(owner));
  return Array.isArray(items) ? items.filter(item => item && /^[a-z0-9-]{1,80}$/i.test(item.id) && Boolean(item.deletedAt) === trash) : [];
}

export function setDrawingTrashed(entries, id, trashed) {
  if (!entries.some(entry => entry.id === id)) throw new Error("Drawing not found in this library.");
  return entries.map(entry => entry.id === id ? { ...entry, deletedAt: trashed ? new Date().toISOString() : null } : entry);
}

export async function trashDrawing(owner, id, trashed = true) {
  drawingKey(id);
  const database = await openDraftDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      const request = store.get(indexKey(owner));
      request.onsuccess = () => {
        try { store.put(setDrawingTrashed(request.result || [], id, trashed), indexKey(owner)); }
        catch { transaction.abort(); }
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Drawing not found."));
    });
  } finally { database.close(); }
}

// The document and library entry commit together, so a failed save cannot leave
// a card pointing to a missing drawing. Existing autosaved drafts are untouched.
export async function saveDrawing(owner, document, options = {}) {
  let result;
  const database = await openDraftDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      const request = store.get(indexKey(owner));
      request.onsuccess = () => {
        const entries = Array.isArray(request.result) ? request.result.filter(item => item && /^[a-z0-9-]{1,80}$/i.test(item.id)) : [];
        // Read current titles too: an opened library drawing may have been renamed
        // by autosave since its card was first created. All reads and writes share
        // one transaction, including competing saves from another tab.
        let remaining = entries.length;
        const finish = () => {
          result = planDrawingSave(entries, document, { ...options, newId: crypto.randomUUID() });
          if (result.status === "conflict") return;
          store.put({ ...document, artworkTitle: result.entry.title }, drawingKey(result.entry.id));
          store.put(result.entries, indexKey(owner));
        };
        if (!remaining) finish();
        entries.forEach((entry, index) => {
          const drawing = store.get(drawingKey(entry.id));
          drawing.onsuccess = () => {
            if (drawing.result?.artworkTitle) entries[index] = { ...entry, title: drawing.result.artworkTitle };
            if (--remaining === 0) finish();
          };
        });
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally { database.close(); }
}
