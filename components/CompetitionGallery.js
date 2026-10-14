"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import EntryReport from "./EntryReport";

export function EntryPreview({ entry, size }) {
  const canvas = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const frames = useMemo(() => entry.frames || [entry.pixels], [entry.frames, entry.pixels]);
  const width = entry.width || size;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % frames.length), 1000 / (entry.fps || 6));
    return () => clearInterval(timer);
  }, [playing, entry.fps, frames.length]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(width, width);
    const pixels = frames[index % frames.length];
    pixels.forEach((color, i) => {
      const rgb = parseInt(color.slice(1), 16);
      image.data.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255], i * 4);
    });
    context.putImageData(image, 0, 0);
  }, [frames, index, width]);
  return <div className="entry-art"><canvas ref={canvas} width={width} height={width} className="entry-preview" role="img" aria-label={entry.title} />
    {frames.length > 1 && <button type="button" aria-label={`${playing ? "Pause" : "Play"} ${entry.title}`} onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play animation"} · {frames.length} frames</button>}</div>;
}

export default function CompetitionGallery({ event, isHost = false, client, user }) {
  const results = event.phase === "results";
  const noWinner = results && event.no_winner;
  const entries = [...event.entries].sort((a, b) => results ? (a.rank || Infinity) - (b.rank || Infinity) || Number(b.score) - Number(a.score) || a.title.localeCompare(b.title) : 0);
  return <section className="gallery-section">
    <div className="section-heading"><div><p className="eyebrow">The gallery</p><h3>{results ? entries.length && !noWinner ? "Final leaderboard" : "Competition closed" : "Submitted artwork"}</h3></div><span>{event.entryCount} {event.entryCount === 1 ? "entry" : "entries"}</span></div>
    {event.moderation_notice && <p className="host-hint">Some artwork has been hidden after moderator review. Hidden entries are excluded from this gallery and final rankings.</p>}
    {noWinner && entries.length > 0 && <p className="empty-gallery">{event.moderation_no_winner ? "No eligible artwork has counted votes after moderation." : event.ended_reason === "drawing_insufficient" ? "Fewer than two entries were submitted, so voting was skipped." : "The voting timer ended without any ballots."} No winner was selected. You can still enjoy the submitted artwork.</p>}
    {results && !noWinner && entries.length > 0 && event.show_points === false && <p className="host-hint">{isHost ? "Points below are visible only to you, the host." : "The host has hidden points. Final rankings are shown below."}</p>}
    {!entries.length && <p className="empty-gallery">{event.moderation_notice ? "No eligible entries are currently visible after moderator review." : results ? "This competition has ended with no entries." : "No entries to show yet."}</p>}
    <div className="entry-gallery">{entries.map((entry) => {
      const rank = entry.rank || entries.findIndex((item) => Number(item.score) === Number(entry.score)) + 1;
      const medal = results && !noWinner && rank <= 3 ? ["gold", "silver", "bronze"][rank - 1] : "";
      return <article className={`entry-card ${medal ? `winner-${medal}` : ""}`} key={entry.id}>
        {medal && <span className="winner-crown" role="img" aria-label={`${medal} winner`}><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l4 4 5-7 5 7 4-4-2 12H5L3 6zm2 14h14" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg></span>}
        <EntryPreview entry={entry} size={event.size} />
        <div>{results && !noWinner && <strong className="rank-label">#{rank}{entry.score != null && (event.show_points !== false || isHost) ? ` · ${Number(entry.score).toFixed(2)} weighted points` : ""}</strong>}<h4>{entry.title}</h4><p>by {entry.artist}</p><small>{entry.width || event.size} × {entry.width || event.size}</small></div>
        {event.challenge_key && client && <EntryReport key={user?.id || "guest"} entry={entry} client={client} user={user} />}
      </article>;
    })}</div>
  </section>;
}
