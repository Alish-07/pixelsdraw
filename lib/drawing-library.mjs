import { editorDraftKeys, openDraftDatabase, readLabDraft } from "./editor-lab-storage.mjs";

export function libraryOwner(user) { return user && !user.is_anonymous ? user.id : "device"; }
export function drawingKey(id) {
  if (!/^[a-z0-9-]{1,80}$/i.test(id)) throw new Error("Invalid drawing ID");
  return editorDraftKeys(null, `drawing:${id}`).primary;
}
const indexKey = owner => `pixelsdraw:library:v1:${owner}`;

export async function listDrawings(owner) {
  const items = await readLabDraft(indexKey(owner));
  return Array.isArray(items) ? items.filter(item => item && /^[a-z0-9-]{1,80}$/i.test(item.id)) : [];
}

// The document and library entry commit together, so a failed save cannot leave
// a card pointing to a missing drawing. Existing autosaved drafts are untouched.
export async function saveDrawing(owner, document) {
  const id = crypto.randomUUID();
  const entry = { id, title: document.artworkTitle || "Untitled artwork", width: document.width, height: document.height, savedAt: new Date().toISOString() };
  const database = await openDraftDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      const request = store.get(indexKey(owner));
      request.onsuccess = () => {
        store.put(document, drawingKey(id));
        store.put([entry, ...(Array.isArray(request.result) ? request.result : [])], indexKey(owner));
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return entry;
  } finally { database.close(); }
}
