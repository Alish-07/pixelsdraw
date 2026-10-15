"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { drawingKey, libraryOwner, listDrawings } from "@/lib/drawing-library.mjs";
import { readLabDraft } from "@/lib/editor-lab-storage.mjs";
import { validEditorDraft } from "@/lib/pixel-document.mjs";
import { rasterBytes } from "@/lib/editor-lab.mjs";
import PixelCanvas from "./PixelCanvas";

function DrawingCard({ entry }) {
  const canvas = useRef(null);
  const [title, setTitle] = useState(entry.title);
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
  return <Link className="drawing-card" href={`/drawings/${entry.id}`}><canvas ref={canvas} width={160} height={160} role="img" aria-label={title} /><strong>{title}</strong><span>Saved {new Date(entry.savedAt).toLocaleDateString()}</span><span>Open drawing →</span></Link>;
}

function LibraryContent({ owner, id }) {
  const [state, setState] = useState({ loading: true, entries: [], error: "" });
  useEffect(() => {
    let active = true;
    listDrawings(owner).then(entries => {
      if (active) setState({ loading: false, entries, error: "" });
    }).catch(() => { if (active) setState({ loading: false, entries: [], error: "Could not open browser storage. Download your work from the editor to keep a backup." }); });
    return () => { active = false; };
  }, [owner]);
  if (state.loading) return <p role="status">Opening your drawings…</p>;
  if (state.error) return <p role="alert">{state.error}</p>;
  if (id) return state.entries.some(entry => entry.id === id)
    ? <><Link className="library-back" href="/drawings">← My drawings</Link><div className="pixel-workspace main-workspace"><PixelCanvas storageScope={`drawing:${id}`} /></div></>
    : <p>This drawing is not in your library on this browser. <Link href="/drawings">Back to My drawings</Link></p>;
  return <div className="drawing-grid">{state.entries.length ? state.entries.map(entry => <DrawingCard key={entry.id} entry={entry} />) : <div className="empty-state"><h2>Your next idea starts here</h2><p>Use “Save copy” in the editor to add a drawing to your library.</p><Link className="button-link" href="/">Start drawing</Link></div>}</div>;
}

export default function DrawingLibrary({ id = null }) {
  const { user, ready } = useAuth();
  const owner = libraryOwner(user);
  return <div className={id ? "drawing-editor-page" : "drawings-page"}>
    {!id && <><h1>My drawings</h1><p>Editable copies saved in this browser. Keep a download as a backup; drawings do not sync between devices yet.</p><Link href="/">← Back to studio</Link></>}
    {ready ? <LibraryContent key={owner + (id || "")} owner={owner} id={id} /> : <p role="status">Checking your account…</p>}
  </div>;
}
