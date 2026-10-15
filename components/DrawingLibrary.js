"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { drawingKey, libraryOwner, listDrawings, trashDrawing } from "@/lib/drawing-library.mjs";
import { readLabDraft } from "@/lib/editor-lab-storage.mjs";
import { validEditorDraft } from "@/lib/pixel-document.mjs";
import { rasterBytes } from "@/lib/editor-lab.mjs";
import PixelCanvas from "./PixelCanvas";

function DrawingCard({ entry, owner, onRemoved }) {
  const canvas = useRef(null);
  const [title, setTitle] = useState(entry.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changing = useRef(false);
  async function changeTrash() {
    if (changing.current) return;
    changing.current = true; setBusy(true); setError("");
    try { await trashDrawing(owner, entry.id, !entry.deletedAt); onRemoved(entry.id); }
    catch { setError("Could not update this drawing. Please try again."); }
    finally { changing.current = false; setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    readLabDraft(drawingKey(entry.id)).then(document => {
      if (!active || !canvas.current || !validEditorDraft(document)) return;
      setTitle(document.artworkTitle || entry.title);
      const surface = window.document.createElement("canvas");
      surface.width = document.width; surface.height = document.height;
      const context = surface.getContext("2d");
      const image = context.createImageData(document.width, document.height);
      image.data.set(rasterBytes(document.frames[0].layers, document.width * document.height));
      context.putImageData(image, 0, 0);
      const preview = canvas.current.getContext("2d");
      preview.clearRect(0, 0, 160, 160); preview.imageSmoothingEnabled = false;
      const scale = Math.min(160 / document.width, 160 / document.height);
      preview.drawImage(surface, (160 - document.width * scale) / 2, (160 - document.height * scale) / 2, document.width * scale, document.height * scale);
    }).catch(() => {});
    return () => { active = false; };
  }, [entry]);
  const preview = <><canvas ref={canvas} width={160} height={160} role="img" aria-label={title} /><strong>{title}</strong><span>Saved {new Date(entry.savedAt).toLocaleDateString()}</span></>;
  return <article className="drawing-card">
    {entry.deletedAt ? <div className="drawing-open">{preview}</div> : <Link className="drawing-open" href={`/drawings/${entry.id}`}>{preview}<span>Open drawing →</span></Link>}
    <button type="button" className="drawing-trash-button" disabled={busy} onClick={changeTrash} aria-label={`${entry.deletedAt ? "Restore" : "Delete"} ${title}`}>{busy ? "Updating…" : entry.deletedAt ? "Restore drawing" : "Delete"}</button>
    {error && <p role="alert">{error}</p>}
  </article>;
}

function LibraryContent({ owner, id, trash }) {
  const [state, setState] = useState({ loading: true, entries: [], error: "" });
  useEffect(() => {
    let active = true;
    listDrawings(owner, trash).then(entries => {
      if (active) setState({ loading: false, entries, error: "" });
    }).catch(() => { if (active) setState({ loading: false, entries: [], error: "Could not open browser storage. Download your work from the editor to keep a backup." }); });
    return () => { active = false; };
  }, [owner, trash]);
  if (state.loading) return <p role="status">Opening your drawings…</p>;
  if (state.error) return <p role="alert">{state.error}</p>;
  if (id) return state.entries.some(entry => entry.id === id)
    ? <><Link className="library-back" href="/drawings">← My drawings</Link><div className="pixel-workspace main-workspace"><PixelCanvas storageScope={`drawing:${id}`} /></div></>
    : <p>This drawing is not in your library on this browser. <Link href="/drawings">Back to My drawings</Link></p>;
  return <div className="drawing-grid">{state.entries.length ? state.entries.map(entry => <DrawingCard key={entry.id} entry={entry} owner={owner} onRemoved={id => setState(previous => ({ ...previous, entries: previous.entries.filter(item => item.id !== id) }))} />) : <div className="empty-state"><h2>{trash ? "Trash is empty" : "Your next idea starts here"}</h2><p>{trash ? "Deleted drawings appear here. You can restore them whenever you need." : "Use Save in the editor to add a drawing to your library."}</p>{!trash && <Link className="button-link" href="/">Start drawing</Link>}</div>}</div>;
}

export default function DrawingLibrary({ id = null }) {
  const { user, ready } = useAuth();
  const owner = libraryOwner(user);
  const [trash, setTrash] = useState(false);
  return <div className={id ? "drawing-editor-page" : "drawings-page"}>
    {!id && <><h1>My drawings</h1><p>Editable copies saved in this browser. Keep a download as a backup; drawings do not sync between devices yet.</p><Link href="/">← Back to studio</Link><div className="history-tabs" role="group" aria-label="Drawing library view"><button type="button" aria-pressed={!trash} onClick={() => setTrash(false)}>Saved</button><button type="button" aria-pressed={trash} onClick={() => setTrash(true)}>Trash</button></div>{trash && <p>Drawings in Trash stay on this browser until you restore them or clear browser data.</p>}</>}
    {ready ? <LibraryContent key={owner + (id || "") + trash} owner={owner} id={id} trash={!id && trash} /> : <p role="status">Checking your account…</p>}
  </div>;
}
