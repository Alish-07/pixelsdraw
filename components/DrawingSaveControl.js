"use client";

import { useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { libraryOwner, saveDrawing } from "@/lib/drawing-library.mjs";

export default function DrawingSaveControl({ getDocument, disabled, onSaved, onRename }) {
  const { user, ready } = useAuth();
  const owner = libraryOwner(user);
  const dialog = useRef(null);
  const pending = useRef(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [collision, setCollision] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function cancel() {
    if (inFlight.current) return;
    dialog.current?.close(); pending.current = null; setCollision(null); setError("");
  }
  async function attempt(document, replaceId) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (pending.current?.owner !== owner) throw new Error("Your account changed. Cancel and save again.");
      const result = await saveDrawing(owner, document, { replaceId });
      if (result.status === "conflict") {
        pending.current.document = document;
        setCollision(result.existing); setName(`${(document.artworkTitle || "Untitled artwork").slice(0, 73)} (copy)`);
        if (!dialog.current.open) dialog.current.showModal();
      } else {
        dialog.current?.close(); pending.current = null; setCollision(null);
        onRename(result.entry.title);
        onSaved(replaceId ? "Drawing replaced in My drawings on this browser." : "Drawing saved to My drawings on this browser.");
      }
    } catch (error) {
      const message = error.message === "Your account changed. Cancel and save again." ? error.message : "Could not save. Download your drawing to keep it safe.";
      if (dialog.current?.open) setError(message);
      else { pending.current = null; onSaved(message); }
    } finally { inFlight.current = false; setBusy(false); }
  }
  function save() {
    // A ref blocks rapid clicks immediately, before React's disabled state paints.
    if (inFlight.current || pending.current || disabled || !ready) return;
    const document = structuredClone(getDocument());
    pending.current = { owner, document };
    attempt(document);
  }
  return <>
    <button type="button" onClick={save} disabled={disabled || !ready || busy} title="Save an editable drawing in this browser">{busy ? "Saving…" : "Save"}</button>
    <dialog ref={dialog} className="drawing-save-dialog" aria-labelledby="drawing-save-heading" onCancel={event => { event.preventDefault(); cancel(); }}>
      <h2 id="drawing-save-heading">A drawing with this name exists</h2>
      <p>Replace “{collision?.title}”, or choose a different name to keep both drawings.</p>
      <button type="button" disabled={busy} onClick={() => attempt(pending.current.document, collision.id)}>Replace existing drawing</button>
      <form onSubmit={event => { event.preventDefault(); if (name.trim()) attempt({ ...pending.current.document, artworkTitle: name.trim() }); }}>
        <label>New drawing name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={busy} /></label>
        <button type="submit" disabled={busy || !name.trim()}>Save with new name</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={cancel}>Cancel</button>
    </dialog>
  </>;
}
