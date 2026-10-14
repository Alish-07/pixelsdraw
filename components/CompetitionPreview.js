"use client";

import { useEffect, useState } from "react";
import CompetitionSettings from "./CompetitionSettings";
import CompetitionGallery from "./CompetitionGallery";
import PixelCanvas from "./PixelCanvas";
import SuggestedField from "./SuggestedField";
import RoomControls from "./RoomControls";
import { artworkTitle, parseTimer, settingsFromForm } from "@/lib/competition-rules.mjs";

// Local-only fixtures: no authentication or remote database writes.
const initial = { id: "local-competition-preview", title: "Tiny worlds", theme: "A world inside a pixel", phase: "submissions", size: 37, canvas_rules: { mode: "list", sizes: [37, 91], min: 1, max: 1024 }, animation_mode: "required", show_points: false, entries: [], entryCount: 0 };
const frame = (color) => Array.from({ length: 16 * 16 }, (_, i) => i % 16 > 3 && i % 16 < 12 && Math.floor(i / 16) > 3 && Math.floor(i / 16) < 12 ? color : "#ffffff");
const winners = { ...initial, phase: "results", size: 16, entries: ["#6d28d9", "#06b6d4", "#f97316"].map((color, i) => ({ id: String(i), rank: i + 1, width: 16, pixels: frame(color), frames: [frame(color), frame("#facc15")], fps: 6, title: ["Moon garden", "Ocean sprite", "Tiny sunset"][i], artist: ["Cosmic Otter", "Neon Fox", "Doodle Owl"][i], score: null })), entryCount: 3 };

export default function CompetitionPreview() {
  const [view, setView] = useState("settings");
  const [event, setEvent] = useState(initial);
  const [message, setMessage] = useState("");
  const [room, setRoom] = useState({ phase: "lobby", participantCount: 1, admission_mode: "approval", allow_late_join: false, pendingPlayers: [{ id: "local-player", nickname: "Pixel Panda" }] });
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!room.scheduled_start_at) return;
    const tick = () => { const time = Date.now(); setNow(time); if (time >= Date.parse(room.scheduled_start_at)) setRoom((current) => ({ ...current, phase: "submissions", scheduled_start_at: null })); };
    const first = setTimeout(tick, 0); const timer = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [room.scheduled_start_at]);
  const remaining = room.scheduled_start_at ? Math.max(0, Math.ceil((Date.parse(room.scheduled_start_at) - now) / 1000)) : 0;
  const countdown = now ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "Starting countdown…";
  return <main className="page-shell competition-page"><p className="eyebrow">Local competition test · no remote writes</p><h1>Competition preview</h1>
    <div className="history-tabs">{["settings", "dashboard", "drawing", "winners", "no votes", "empty"].map((item) => <button key={item} onClick={() => setView(item)} aria-pressed={view === item}>{item}</button>)}</div>
    {view === "settings" && <div className="competition-form"><SuggestedField name="previewNickname" label="Nickname" kind="nickname" maxLength={60} /><SuggestedField name="previewName" label="Competition name" kind="competition" maxLength={80} /><SuggestedField name="previewTheme" label="Theme" kind="theme" maxLength={160} /></div>}
    {view === "dashboard" && <><p>Room phase: {room.phase}</p><RoomControls event={room} busy={false} countdown={countdown} onControls={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); setRoom({ ...room, admission_mode: data.get("admissionMode"), allow_late_join: data.get("allowLateJoin") === "on" }); setMessage("Admission saved locally."); }} onAdmit={(id, admit) => { setRoom({ ...room, participantCount: room.participantCount + (admit ? 1 : 0), pendingPlayers: room.pendingPlayers.filter((player) => player.id !== id) }); setMessage(admit ? "Player admitted locally." : "Request declined locally."); }} onSchedule={(value) => { try { const seconds = value === 0 ? 0 : parseTimer(String(value)); if (seconds === null) throw new Error("Enter minutes:seconds."); setNow(Date.now()); setRoom({ ...room, scheduled_start_at: seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null }); setMessage(seconds ? `Local countdown: ${seconds} seconds.` : "Countdown cancelled locally."); } catch (error) { setMessage(error.message); } }} /></>}
    {view === "settings" && <form className="competition-form create-event-card" onSubmit={(e) => { e.preventDefault(); try { const settings = settingsFromForm(new FormData(e.currentTarget)); setEvent({ ...initial, size: settings.p_size, canvas_rules: settings.p_rules, animation_mode: settings.p_animation, show_points: settings.p_show_points, voting_duration_seconds: settings.p_voting_duration_seconds }); setMessage(`Saved locally: drawing ${settings.p_duration_seconds} seconds; voting ${settings.p_voting_duration_seconds} seconds; host ${settings.p_host_vote_percent}%.`); } catch (error) { setMessage(error.message); } }}><CompetitionSettings /><button className="primary-button">Test settings locally</button><p role="status">{message}</p></form>}
    {view === "drawing" && <div className="pixel-workspace shared-editor"><PixelCanvas competition={event} participantName="Cosmic Otter" storageScope="lab" onSubmitArtwork={async (artwork) => { setMessage(`Local submission: ${artworkTitle(artwork.title)}, ${artwork.size} × ${artwork.size}, ${artwork.frames.length} frames.`); return ""; }} /></div>}
    {view === "winners" && <CompetitionGallery event={winners} />}
    {view === "no votes" && <CompetitionGallery event={{ ...winners, ballotCount: 0, ended_reason: "voting_timeout", no_winner: true }} />}
    {view === "empty" && <><h2>Competition ended</h2><p>No artwork was submitted. The drawing window is closed.</p><CompetitionGallery event={{ ...initial, phase: "results" }} /></>}
    {view !== "settings" && <p role="status">{message}</p>}
  </main>;
}
