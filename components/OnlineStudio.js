"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { isValidJoinCode, normalizeJoinCode, normalizeNickname } from "@/lib/competition.mjs";
import AccountPanel from "./AccountPanel";
import PixelCanvas from "./PixelCanvas";
import CompetitionSettings from "./CompetitionSettings";
import CompetitionGallery from "./CompetitionGallery";
import SuggestedField from "./SuggestedField";
import RoomControls from "./RoomControls";
import PublicChallenges from "./PublicChallenges";
import ModerationPanel from "./ModerationPanel";
import { artworkTitle, describeCanvas, parseTimer, roomCategory, settingsFromForm, suggestedValue } from "@/lib/competition-rules.mjs";
import { phaseLabel } from "@/lib/site-ui.mjs";
import { useAuth } from "./AuthProvider";
import { accountProfile, draftOwner } from "@/lib/account-profile.mjs";


function competitionError(error, fallback) {
  if (["PGRST202", "42703"].includes(error?.code)) return "Competitions are temporarily unavailable. Please try again shortly.";
  if (/fetch|network/i.test(error?.message || "")) return "Connection interrupted. Please check your connection and try again.";
  return error?.message || fallback;
}

function formatTimeLeft(deadline, now) {
  if (!deadline) return "No timer";
  if (!now) return "Starting timer…";
  const milliseconds = new Date(deadline).getTime() - now;
  if (milliseconds <= 0) return "Time is up";
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function ParticipantRoster({ event, isHost }) {
  return <section className="roster-card">
    <div className="section-heading"><div><p className="eyebrow">The room</p><h3>Players in the room</h3></div>
      <span>{event.participantCount} joined</span></div>
    {!event.participants.length ? <p className="empty-gallery">Share the code and participants will appear here automatically.</p> :
      <div className="participant-roster">{event.participants.map((participant, index) => <div key={`${participant.nickname}-${index}`}>
        <span className={`presence-dot ${participant.isActive ? "active" : ""}`} aria-hidden="true" />
        <strong>{participant.nickname}</strong>
        <small>{isHost ? (participant.isActive ? participant.status : "away") : (participant.isActive ? "online" : "away")}</small>
      </div>)}</div>}
  </section>;
}

function Ballot({ client, event, user, onSaved, isHost, votingClosed = false }) {
  const [choices, setChoices] = useState(["", "", ""]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await client.rpc("pixel_my_ballot", { p_event: event.id });
        if (error) throw error;
        if (!cancelled && data) setChoices([data[0] || "", data[1] || "", data[2] || ""]);
      } catch (error) {
        if (!cancelled) setMessage(error.message || "Could not load your previous ballot.");
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [client, event.id, user.id]);

  async function submit(formEvent) {
    formEvent.preventDefault();
    if (busy) return;
    if (event.voting_deadline && Date.parse(event.voting_deadline) <= Date.now()) { setMessage("Voting has closed. Results are updating automatically."); await onSaved(); return; }
    if ((!choices[0] && (choices[1] || choices[2])) || (!choices[1] && choices[2])) {
      return setMessage("Choose entries in order, starting with first choice.");
    }
    setBusy(true);
    try {
      const { error } = await client.rpc("pixel_save_ballot", { p_event: event.id, p_choices: choices.filter(Boolean) });
      if (error) throw error;
      setMessage("Your ballot is saved. You can replace it until voting closes.");
      await onSaved();
    } catch (error) {
      setMessage(error.message || "Could not save your ballot.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="competition-form ballot-card" onSubmit={submit}>
    <p className="eyebrow">{isHost ? "Host vote" : "Your vote"}</p><h3>Rank your favorites</h3>
    <p>Choose up to three different entries for 3, 2, and 1 points. You cannot vote for your own artwork.</p>
    <fieldset className="ballot-fields" disabled={busy || !ready || votingClosed}>
      {choices.map((choice, rank) => <label key={rank}>{["First", "Second", "Third"][rank]} choice
        <select value={choice} required={rank === 0} onChange={(e) => setChoices(choices.map((old, i) => i === rank ? e.target.value : old))}>
          <option value="">{rank === 0 ? "Choose an entry" : "Optional"}</option>
          {event.entries.map((entry) => <option key={entry.id} value={entry.id}
            disabled={entry.artist_id === user.id || choices.some((id, i) => i !== rank && id === entry.id)}>
            {entry.title} — {entry.artist}
          </option>)}
        </select>
      </label>)}
      <button className="primary-button">{busy ? "Saving…" : "Save my ballot"}</button>
    </fieldset>
    <p role="status" className="form-message">{message}</p>
  </form>;
}

export default function OnlineStudio(props) {
  const { user, ready } = useAuth();
  if (!ready) return <p role="status">Opening competitions…</p>;
  return <AccountOnlineStudio key={draftOwner(user)} {...props} owner={draftOwner(user)} />;
}

function AccountOnlineStudio({ owner, eventId = null, initialHosting = false }) {
  const nicknameKeyPrefix = `pixelsdraw:competition-nickname:${owner}:`;
  const hosting = initialHosting;
  const router = useRouter();
  const [client] = useState(getSupabase);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [event, setEvent] = useState(null);
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [joinMessage, setJoinMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [participantName, setParticipantName] = useState("");
  const [participantReady, setParticipantReady] = useState(!eventId);
  const [now, setNow] = useState(0);
  const [historyTab, setHistoryTab] = useState("current");
  const [moderator, setModerator] = useState(null);
  const [moderatorPanel, setModeratorPanel] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const deleteDialog = useRef(null);
  useEffect(() => { const tick = window.setTimeout(() => { setNow(Date.now()); }, 0); return () => window.clearTimeout(tick); }, []);
  const requestNumber = useRef(0);
  const snapshotCache = useRef(null);
  const refreshing = useRef(false);
  const retryAfter = useRef(0);
  const competitionEditor = useRef(null);
  const hostUser = user && !user.is_anonymous ? user : null;
  const isHost = Boolean(event && event.host_id === user?.id);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let authChanged = false;
    client.auth.getSession().then(({ data, error }) => {
      if (cancelled || authChanged) return;
      if (error) setMessage(error.message);
      setUser(data.session?.user || null);
      setAuthReady(true);
    }).catch(() => {
      if (!cancelled) { setMessage("Could not check your account. Refresh to retry."); setAuthReady(true); }
    });
    const { data: { subscription } } = client.auth.onAuthStateChange((_name, session) => {
      authChanged = true;
      if (!cancelled) { setUser(session?.user || null); setAuthReady(true); }
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      let allowed = false;
      try {
        if (client && user && !user.is_anonymous) {
          const { data, error } = await client.rpc("pixel_moderation_status");
          allowed = !error && data === true;
        }
      } catch { /* Missing upgrade or network failure must never grant access. */ }
      if (!cancelled) setModerator(allowed ? user.id : null);
    }
    check();
    return () => { cancelled = true; };
  }, [client, user]);

  useEffect(() => {
    if (!eventId) return;
    const timer = window.setTimeout(() => {
      try {
        const savedName = normalizeNickname(localStorage.getItem(nicknameKeyPrefix + eventId));
        setParticipantName(savedName);
        setShowEditor(Boolean(savedName));
      } catch { /* A disabled browser store must not prevent joining a room. */ }
      finally {
        setParticipantReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [eventId, nicknameKeyPrefix]);

  const refresh = useCallback(async () => {
    if (!client || refreshing.current || Date.now() < retryAfter.current) return;
    refreshing.current = true;
    const request = ++requestNumber.current;
    try {
      if (eventId) {
        const cached = snapshotCache.current?.id === eventId ? snapshotCache.current : null;
        const { data, error } = await client.rpc("pixel_event_snapshot_delta", { p_event: eventId, p_art_version: cached?.art_version || null });
        if (error) throw error;
        if (request !== requestNumber.current) return;
        const next = data?.art_unchanged && cached ? { ...cached, ...data } : data;
        snapshotCache.current = next;
        setEvent(next);
        if (data?.my_nickname) {
          setParticipantName(data.my_nickname);
          try { localStorage.setItem(nicknameKeyPrefix + eventId, data.my_nickname); } catch { /* Keep the live session working without browser storage. */ }
        }
      } else if (hostUser) {
        const { data, error } = await client.rpc("pixel_host_events");
        if (error) throw error;
        if (request !== requestNumber.current) return;
        setEvents(data);
        setNow(Date.now());
      } else {
        setEvents([]);
      }
      setLoadError("");
    } catch (error) {
      if (error.code === "PT429" || error.status === 429) retryAfter.current = Date.now() + 60000;
      if (request === requestNumber.current) setLoadError(competitionError(error, "Could not load competitions."));
    } finally {
      refreshing.current = false;
      if (request === requestNumber.current) setLoaded(true);
    }
  }, [client, eventId, hostUser, nicknameKeyPrefix]);

  useEffect(() => {
    // The database response is the external event that updates this client view.
    refresh();
    const request = requestNumber.current;
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (requestNumber.current === request) requestNumber.current++;
    };
  }, [refresh]);

  useEffect(() => {
    if (!eventId && !hostUser) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, eventId ? 10000 : 30000);
    return () => window.clearInterval(timer);
  }, [eventId, hostUser, refresh]);

  useEffect(() => {
    if (!(event?.submission_deadline && event.phase === "submissions") && !(event?.scheduled_start_at && event.phase === "lobby") && !(event?.voting_deadline && event.phase === "voting")) return;
    const firstTick = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(firstTick); window.clearInterval(timer); };
  }, [event?.phase, event?.submission_deadline, event?.scheduled_start_at, event?.voting_deadline]);

  const hasSubmitted = Boolean(event?.my_entry_exists || event?.entries.some((entry) => entry.artist_id === user?.id));
  const isAdmitted = event?.my_admission === "admitted";
  const heartbeatStatus = event?.phase === "voting" ? "voting" : hasSubmitted ? "submitted" : event?.phase === "submissions" && showEditor && isAdmitted ? "drawing" : "joined";
  useEffect(() => {
    if (!client || !eventId || !user?.id || !participantName || isHost || !event?.my_admission) return;
    let cancelled = false;
    let inFlight = false;
    let retryPresence = false;
    async function heartbeat() {
      if (cancelled) return;
      if (inFlight) { retryPresence = true; return; }
      inFlight = true;
      try {
        const { error } = await client.rpc("pixel_heartbeat_v2", { p_event: eventId, p_status: heartbeatStatus, p_present: document.visibilityState === "visible" });
        if (error && !cancelled) setMessage(error.message);
      } catch { /* The next heartbeat/focus retries a temporary connection failure. */ }
      finally { inFlight = false; if (retryPresence && !cancelled) { retryPresence = false; await heartbeat(); } }
    }
    const returnToRoom = async () => { await heartbeat(); if (!cancelled) refresh(); };
    heartbeat();
    const timer = window.setInterval(heartbeat, 15000);
    window.addEventListener("focus", returnToRoom);
    window.addEventListener("online", returnToRoom);
    window.addEventListener("pageshow", returnToRoom);
    document.addEventListener("visibilitychange", returnToRoom);
    return () => {
      cancelled = true; window.clearInterval(timer);
      window.removeEventListener("focus", returnToRoom); window.removeEventListener("online", returnToRoom); window.removeEventListener("pageshow", returnToRoom); document.removeEventListener("visibilitychange", returnToRoom);
    };
  }, [client, eventId, user?.id, participantName, isHost, event?.my_admission, heartbeatStatus, refresh]);

  async function ensureParticipantSession(nickname) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (sessionData.session?.user) return sessionData.session.user;
    const { data, error } = await client.auth.signInAnonymously({ options: { data: { nickname } } });
    if (error) throw error;
    setUser(data.user);
    setAuthReady(true);
    return data.user;
  }

  async function joinCompetition(formEvent) {
    formEvent.preventDefault();
    if (!client || busy) return;
    const form = new FormData(formEvent.currentTarget);
    const code = normalizeJoinCode(form.get("joinCode"));
    const nickname = normalizeNickname(suggestedValue(form, "nickname"));
    if (!isValidJoinCode(code)) return setJoinMessage("Enter the six-digit code from your host.");
    if (!nickname) return setJoinMessage("Choose a nickname so the host knows who joined.");
    setBusy(true);
    setJoinMessage("");
    try {
      const { data: id, error } = await client.rpc("pixel_event_by_code", { p_code: code });
      if (error) throw error;
      if (!id) return setJoinMessage("That code does not match an active competition. Check it and try again.");
      await ensureParticipantSession(nickname);
      const { data: joined, error: joinError } = await client.rpc("pixel_join_event_v2", { p_event: id, p_nickname: nickname, p_suggested: form.get("nicknameAuto") === "true" });
      if (joinError) throw joinError;
      try { localStorage.setItem(nicknameKeyPrefix + id, joined.nickname); } catch { /* Joining does not depend on draft storage. */ }
      router.push(`/events/${id}`);
    } catch (error) {
      setJoinMessage(error.message || "Could not find that competition.");
    } finally {
      setBusy(false);
    }
  }

  async function joinEventWithNickname(formEvent) {
    formEvent.preventDefault();
    if (busy) return;
    const data = new FormData(formEvent.currentTarget);
    const nickname = normalizeNickname(suggestedValue(data, "nickname"));
    if (!nickname) return setMessage("Choose a nickname to join this competition.");
    setBusy(true);
    setMessage("");
    try {
      if (event.challenge_key && !hostUser) throw new Error("Sign in with Google or email to join a public challenge.");
      await ensureParticipantSession(nickname);
      const { data: joined, error } = await client.rpc("pixel_join_event_v2", { p_event: event.id, p_nickname: nickname, p_suggested: data.get("nicknameAuto") === "true" });
      if (error) throw error;
      try { localStorage.setItem(nicknameKeyPrefix + event.id, joined.nickname); } catch { /* Joining does not depend on draft storage. */ }
      setParticipantName(joined.nickname);
      setShowEditor(true);
      setMessage(joined.admission === "pending" ? "Your request is sent. Waiting for host approval." : `Joined as ${joined.nickname}.`);
      await refresh();
    } catch (error) {
      setMessage(error.message || "Could not join with that nickname.");
    } finally {
      setBusy(false);
    }
  }

  async function createEvent(formEvent) {
    formEvent.preventDefault();
    if (!user || busy) return;
    const data = new FormData(formEvent.currentTarget);

    setBusy(true);
    setMessage("");
    try {
      const { data: id, error } = await client.rpc("pixel_create_event_v5", {
        p_title: suggestedValue(data, "title", "Pixel Challenge"), p_theme: suggestedValue(data, "theme", "A tiny world"), ...settingsFromForm(data),
      });
      if (error) throw error;
      router.push(`/events/${id}`);
    } catch (error) {
      setMessage(competitionError(error, "Could not create the competition."));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(formEvent) {
    formEvent.preventDefault();
    if (busy) return;
    const data = new FormData(formEvent.currentTarget);

    setBusy(true);
    try {
      const { error } = await client.rpc("pixel_update_event_settings_v5", { p_event: event.id, ...settingsFromForm(data, event) });
      if (error) throw error;
      setMessage("Room settings updated for everyone.");
      await refresh();
    } catch (error) {
      setMessage(competitionError(error, "Could not update room settings."));
    } finally {
      setBusy(false);
    }
  }

  async function submitArtwork(artwork, artist, title) {
    if (!user || !participantName || !isAdmitted) return "Join and wait for admission before submitting.";
    try {
      const { error } = await client.rpc("pixel_submit_entry_v2", {
        p_event: event.id, p_artist: artist.trim(), p_title: artworkTitle(title), p_size: artwork.size, p_frames: artwork.frames, p_fps: artwork.fps,
      });
      if (error) throw error;
      setMessage("Artwork submitted. Everyone's room will update automatically.");
      setShowEditor(false);
      await refresh();
      return "";
    } catch (error) {
      return competitionError(error, "Submission failed. Your drawing is still saved locally.");
    }
  }

  async function advancePhase(nextPhase) {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await client.rpc("pixel_advance_event", { p_event: event.id, p_next_phase: nextPhase });
      if (error) throw error;
      setMessage(nextPhase === "submissions" ? "Drawing started for everyone." :
        nextPhase === "voting" ? "Voting opened for everyone." : "Voting closed. Results are final.");
      await refresh();
    } catch (error) {
      setMessage(error.message || "Could not change the competition.");
    } finally {
      setBusy(false);
    }
  }

  async function changeRoom(action, args, success) {
    if (busy) return;
    setBusy(true);
    try { const { error } = await client.rpc(action, { p_event: event.id, ...args }); if (error) throw error; setMessage(success); await refresh(); }
    catch (error) { setMessage(competitionError(error, "Could not update the room.")); } finally { setBusy(false); }
  }
  function updateAdmissions(e) {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    return changeRoom("pixel_set_room_controls", { p_admission_mode: data.get("admissionMode"), p_allow_late_join: data.get("allowLateJoin") === "on", p_show_roster: event.show_roster !== false }, "Admission settings updated.");
  }
  function admitPlayer(id, admit) { return changeRoom("pixel_admit_player", { p_player: id, p_admit: admit }, admit ? "Player admitted." : "Request declined."); }
  function scheduleStart(value) {
    try { const seconds = value === 0 ? 0 : parseTimer(String(value)); if (seconds === null) throw new Error("Enter a countdown, such as 2:00."); return changeRoom("pixel_schedule_start", { p_seconds: seconds }, seconds ? "Countdown scheduled for everyone." : "Countdown cancelled."); }
    catch (error) { setMessage(error.message); }
  }

  async function setDeleted(room, deleted) {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await client.rpc("pixel_set_event_deleted", { p_event: room.id, p_deleted: deleted });
      if (error) throw error;
      deleteDialog.current?.close();
      setDeleteTarget(null);
      setMessage(deleted ? "Competition moved to Deleted. Its artwork is preserved; you can restore it." : "Competition restored.");
      await refresh();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function copyText(value, successMessage) {
    try { await navigator.clipboard.writeText(value); setMessage(successMessage); }
    catch { setMessage(`Could not copy automatically. Use: ${value}`); }
  }

  if (!client && eventId) return <main id="main-content" tabIndex={-1} className="page-shell competition-page"><section className="competition unavailable-card">
    <p className="eyebrow">We&apos;ll be back soon</p><h2>Competitions are taking a short break.</h2>
    <p>You can still create pixel art in the studio. Please try competitions again later.</p>
    <Link className="primary-button button-link" href="/">Open studio</Link>
  </section></main>;

  const canSeeGallery = isHost || ["voting", "results"].includes(event?.phase) ||
    (event?.phase === "submissions" && event?.show_gallery && hasSubmitted);
  const canFinishVoting = event?.ballotCount > 0 &&
    (event.host_vote_percent === 0 || event.hostBallotCount > 0) &&
    (event.host_vote_percent === 100 || event.communityBallotCount > 0);

  return <main id="main-content" tabIndex={-1} className="page-shell competition-page">

    {!eventId ? <>
      {!hosting ? <><section className="competition-hero competition-lobby-hero">
        <div className="lobby-heading"><div><p className="eyebrow">Create together</p><h1>Got a room code?</h1>
        <p>A theme, a few pixels, and a little friendly competition.</p></div>
        <Link className="secondary-button host-launch" href="/events?host=1">Host competition <span aria-hidden="true">→</span></Link></div>
        <form className="join-card" onSubmit={joinCompetition}>
          <fieldset disabled={busy || !client}><div className="join-fields"><label htmlFor="join-code">Room code
            <input id="join-code" name="joinCode" inputMode="numeric" autoComplete="off" required maxLength={8} placeholder="123 456" aria-describedby="join-help" /></label>
            <SuggestedField name="nickname" label="Nickname" kind="nickname" maxLength={60} autoComplete="nickname" preferredName={accountProfile(user).displayName} />
            <button className="primary-button">{busy ? "Finding…" : "Join room"}</button></div></fieldset>
          <p id="join-help" role="status">{joinMessage || (!client ? "Joining rooms is temporarily unavailable. Your studio drawings are still available." : "Join with a nickname. No account needed.")}</p>
        </form>
      </section><PublicChallenges client={client} /></> : <section className="host-area host-setup">
        <Link className="back-link" href="/events">← Back to competitions</Link>
        <div className="section-heading"><div><p className="eyebrow">Your room, your rules</p><h1>Host a competition</h1><p>Choose a theme, set the rules, and invite your players.</p></div></div>
        {!hostUser && (client ? <AccountPanel client={client} user={user} ready={authReady} /> : <p role="status">Hosting is temporarily unavailable. Please try again later.</p>)}
        {message && <p role="status" className="local-notice">{message}</p>}
        {loadError && <p role="alert" className="error-notice">{loadError}</p>}
        {hostUser ? <div>
          <form className="competition-form create-event-card" onSubmit={createEvent}>
            <p className="eyebrow">New competition</p><h3>Choose the challenge</h3>
            <fieldset className="ballot-fields" disabled={busy}>
              <SuggestedField name="title" label="Competition name" kind="competition" maxLength={80} />
              <SuggestedField name="theme" label="Theme" kind="theme" maxLength={160} />
              <CompetitionSettings />
              <button className="primary-button">{busy ? "Creating…" : "Create competition"}</button>
            </fieldset>
          </form>
        </div> : null}
      </section>}
      {!hosting && message && <p role="status" className="local-notice">{message}</p>}
      {!hosting && loadError && <p role="alert" className="error-notice">{loadError}</p>}
      {!hosting && hostUser && <section className="host-area hosted-rooms"><div className="your-events">
            <p className="eyebrow">Your rooms</p><h3>Competitions you host</h3>
            <div className="history-tabs" role="group" aria-label="Competition history">{[["current", "Current"], ["past", "Past"], ["trash", "Deleted"]].map(([id, label]) => <button key={id} type="button" aria-pressed={historyTab === id} onClick={() => setHistoryTab(id)}>{label}</button>)}</div>
            <p className="host-hint">{historyTab === "current" ? "Your recent, open competitions." : historyTab === "past" ? "Revisit finished competitions and older rooms." : "Restore a room to make it available again."}</p>
            {!loaded ? <p>Loading…</p> : <div className="event-list">{events.filter((item) => roomCategory(item, now) === historyTab).map((item) => <div className="history-room" key={item.id}>
              {item.deleted_at ? <div><strong>{item.title}</strong><span>{item.theme}</span></div> : <Link href={`/events/${item.id}`}><span className="event-code">{item.join_code}</span><strong>{item.title}</strong><span>{item.theme} · {phaseLabel(item.phase)} · {new Date(item.created_at).toLocaleDateString()}</span></Link>}
              {item.deleted_at ? <button disabled={busy} onClick={() => setDeleted(item, false)}>Restore</button> : <button aria-label={`Delete ${item.title}`} disabled={busy} onClick={() => { setDeleteTarget(item); deleteDialog.current.showModal(); }}>Delete</button>}
            </div>)}{!events.some((item) => roomCategory(item, now) === historyTab) && <p className="empty-state">No competitions in this section.</p>}</div>}
            <dialog ref={deleteDialog} className="room-delete-dialog"><h3>Delete {deleteTarget?.title}?</h3><p>Participants will lose access to the room and its code. Artwork and votes are preserved; restore it from Deleted.</p><div><button onClick={() => deleteDialog.current.close()}>Cancel</button><button disabled={busy} onClick={() => setDeleted(deleteTarget, true)}>Delete competition</button></div><p role="status">{message}</p></dialog>
          </div>
      </section>}
      {!hosting && user && moderator === user.id && <section className="lobby-moderation" aria-labelledby="lobby-moderation-heading"><div className="section-heading"><div><p className="eyebrow">Admin workspace</p><h2 id="lobby-moderation-heading">Moderation</h2><p>Review reports and keep public galleries welcoming.</p></div><button className="secondary-button" aria-controls="public-report-queue" aria-expanded={moderatorPanel} onClick={() => setModeratorPanel(!moderatorPanel)}>{moderatorPanel ? "Close reports" : "Review public reports"}</button></div>{moderatorPanel && <div id="public-report-queue"><ModerationPanel key={user.id} client={client} /></div>}</section>}
    </> : !loaded ? <section className="event-loading"><p>Opening competition…</p></section> : !event ?
      <section className="competition unavailable-card"><h2>{loadError ? "Competition unavailable" : "Competition not found"}</h2>
        <p>{loadError || "Check the link or return to the competition lobby."}</p><Link href="/events">← Back to competitions</Link></section> : <>
        <section className="event-hero-card">
          <div><Link className="back-link" href={event.challenge_key ? "/events#public-challenges" : "/events"}>{event.challenge_key ? "← Public Challenges" : "← Competition lobby"}</Link><p className="eyebrow">{event.phase === "lobby" ? "Waiting for players" : event.phase === "submissions" ? "Submissions open" : event.phase === "voting" ? "Voting open" : event.entryCount === 0 ? "Competition ended" : "Results ready"}</p>
            <h1>{event.title}</h1><p className="event-theme">Theme: <strong>{event.theme}</strong></p></div>
          {event.challenge_key ? <div className="code-display"><span>Public challenge</span><strong>{event.size} × {event.size}</strong><span>Community vote</span></div> : <div className="code-display"><span>Join code</span><strong>{event.join_code}</strong><button onClick={() => copyText(event.join_code, "Join code copied.")}>Copy code</button></div>}
        </section>
        <div className="event-action-row">
          <div className="event-summary"><span>{describeCanvas(event)}</span><span>{event.animation_mode === "required" ? "Animation required" : event.animation_mode === "optional" ? "Still or animation" : "Still artwork"}</span><span>{event.entryCount} entries</span><span>{event.ballotCount} ballots</span>
            {event.phase === "lobby" && event.scheduled_start_at && <span className="timer-chip">Starts in {formatTimeLeft(event.scheduled_start_at, now)}</span>}
            {event.phase === "submissions" && <span className="timer-chip">Drawing: {formatTimeLeft(event.submission_deadline, now)}</span>}
            {event.phase === "voting" && <span className="timer-chip">Voting closes in {formatTimeLeft(event.voting_deadline, now)}</span>}</div>
          <button className="text-button" onClick={() => copyText(window.location.href, "Competition link copied.")}>Copy direct link</button><span className={`live-label ${loadError ? "offline" : ""}`}><i /> {loadError ? "Reconnecting…" : "Auto-updating"}</span>
        </div>
        {!authReady || !participantReady ? <p className="host-signin-note">Preparing your participant session…</p>
          : isHost ? <div className="participant-session"><span>Signed in as the host.</span><Link href="/events">Manage your competitions</Link></div>
            : event.challenge_key && !hostUser ? <AccountPanel client={client} user={user} ready={authReady} publicChallenge />
            : user && participantName && event.my_admission ? <div className="participant-session"><span>Playing as <strong>{participantName}</strong></span><span>Room updates automatically</span></div>
              : ["lobby", "submissions"].includes(event.phase) ? <form className="nickname-card" onSubmit={joinEventWithNickname}>
                <div><p className="eyebrow">Join this competition</p><h3>Choose your nickname</h3><p>{event.challenge_key ? "You are signed in. Choose a public nickname for your artwork." : "Your nickname appears beside your artwork. No email or password is needed."}</p></div>
                <SuggestedField name="nickname" label="Nickname" kind="nickname" maxLength={60} autoComplete="nickname" preferredName={accountProfile(user).displayName} />
                <button className="primary-button" disabled={busy}>{busy ? "Joining…" : "Join competition"}</button>
              </form> : <p className="host-signin-note">{event.challenge_key && event.phase === "voting" ? "Audience voting is open. You do not need to have submitted artwork to vote." : "This competition is no longer accepting new participants."}</p>}
        {event.challenge_key && <p className="host-hint">{event.phase === "submissions" ? "Create your entry before the timer ends. The gallery opens for voting when drawing closes." : event.phase === "voting" ? "The gallery is open. Pick your favorites before voting closes." : <>Ready for another? <Link href="/events#public-challenges">Find your next challenge</Link>.</>}</p>}
        {event.my_entry_hidden && <p className="error-notice" role="status">Your artwork has been hidden after moderator review. Your submission is preserved and cannot be resubmitted in this round.</p>}
        {message && <p role="status" className="local-notice">{message}</p>}
        {loadError && <p role="alert" className="error-notice">{loadError}</p>}
        <section className="competition event-room">
          {isHost && <>
            <div className="host-dashboard">
              <div><span>Joined</span><strong>{event.participantCount}</strong></div><div><span>Active now</span><strong>{event.activeCount}</strong></div>
              <div><span>Drawing</span><strong>{event.drawingCount}</strong></div><div><span>Submitted</span><strong>{event.submittedCount}</strong></div>
              <div><span>Voted</span><strong>{event.ballotCount}</strong></div>
            </div>
            {["lobby", "submissions"].includes(event.phase) && <form className="host-settings competition-form" onSubmit={saveSettings} key={JSON.stringify([event.canvas_rules, event.animation_mode, event.show_points, event.show_gallery, event.host_vote_percent, event.submission_deadline, event.show_roster, event.admission_mode, event.allow_late_join, event.voting_duration_seconds])}>
              <div><p className="eyebrow">Room settings</p><h3>Competition rules</h3></div><fieldset className="ballot-fields" disabled={busy}><CompetitionSettings event={event} /><button className="secondary-button">Save settings</button></fieldset>
            </form>}
            <RoomControls event={event} busy={busy} countdown={formatTimeLeft(event.scheduled_start_at, now)} onControls={updateAdmissions} onAdmit={admitPlayer} onSchedule={scheduleStart} />
            <div className="host-controls">
              <div><p className="eyebrow">Host controls</p><h3>Move the room forward</h3><p>Everyone sees phase changes automatically.</p></div>
              {event.phase === "lobby" && <button className="primary-button" disabled={busy || event.participantCount < 1} onClick={() => advancePhase("submissions")}>Start drawing</button>}
              {event.phase === "submissions" && <button className="primary-button" disabled={busy || event.entryCount < 2} onClick={() => advancePhase("voting")}>Open voting</button>}
              {event.phase === "voting" && <button className="primary-button" disabled={busy || !canFinishVoting} onClick={() => advancePhase("results")}>Finish voting</button>}
            </div>
            {event.phase === "submissions" && event.submission_deadline && <p className="host-hint">Voting opens automatically when drawing ends if there are at least two entries. Otherwise the room closes without a winner.</p>}
            {event.phase === "voting" && <p className="host-hint">Results appear automatically when the voting timer ends, even if the host or participants have not voted. Only received ballots count; unused voting weight is not redistributed.{!canFinishVoting && " To finish early, the required host/community ballots must be saved first."}</p>}
          </>}

          {!isHost && user && participantName && event.my_admission && !isAdmitted && ["lobby", "submissions"].includes(event.phase) && <div className="waiting-callout"><div><p className="eyebrow">Admission</p><h3>{event.my_admission === "rejected" ? "Your request was declined" : "Waiting for host approval"}</h3><p>{event.my_admission === "rejected" ? "Contact the host if you think this was a mistake." : "Your canvas will unlock automatically once the host admits you."}</p></div></div>}
          {event.phase === "lobby" && !isHost && user && participantName && isAdmitted && <div className="waiting-callout">
            <span className="waiting-pulse" aria-hidden="true" /><div><p className="eyebrow">You are in</p><h3>{event.scheduled_start_at ? `Drawing starts in ${formatTimeLeft(event.scheduled_start_at, now)}` : "Waiting for the host to start"}</h3>
              <p>Your {describeCanvas(event)} canvas will appear here automatically.</p></div></div>}
          {event.phase === "lobby" && (isHost || event.show_roster !== false) && <ParticipantRoster event={event} isHost={isHost} />}

          {event.phase === "submissions" && !isHost && isAdmitted && (hasSubmitted
            ? <p className="success-notice">{event.challenge_key ? "Your artwork is submitted. The gallery and voting open automatically when drawing ends." : "Your artwork is submitted. You can view the gallery below when the host allows it."}</p>
            : user && participantName ? <>
                <div className="participant-callout"><div><p className="eyebrow">Step 1 · Draw and submit</p><h3>Your {describeCanvas(event)} canvas is ready</h3><p>Choose a canvas allowed by the room rules. Your draft stays saved on this device.</p></div>
                  <div><button className="primary-button" onClick={() => setShowEditor(!showEditor)}>{showEditor ? "Hide editor" : "Open editor"}</button>{showEditor && <button className="secondary-button" onClick={() => competitionEditor.current?.requestFullscreen().catch(() => setMessage("Fullscreen is unavailable in this browser."))}>Focus canvas · Esc to exit</button>}</div></div>
                {showEditor && <div ref={competitionEditor} className="shared-editor pixel-workspace"><PixelCanvas isActive competition={event} participantName={participantName} onSubmitArtwork={submitArtwork} /></div>}
              </>
              : <p className="host-signin-note">Join with a nickname above when you are ready to create artwork.</p>)}

          {event.phase !== "lobby" && event.phase !== "results" && (isHost || (isAdmitted && event.show_roster !== false)) && <ParticipantRoster event={event} isHost={isHost} />}
          {event.phase === "voting" && <><CompetitionGallery event={event} isHost={isHost} client={client} user={user} />
            {user && (isAdmitted || isHost || (event.challenge_key && hostUser)) ? <Ballot key={user.id} client={client} event={event} user={user} isHost={isHost} votingClosed={Boolean(event.voting_deadline && now >= Date.parse(event.voting_deadline))} onSaved={refresh} />
              : <p className="host-signin-note">{event.challenge_key ? "Sign in above to vote for your favorites. Audience members are welcome." : "Join with a nickname above to vote."}</p>}</>}
          {event.phase === "results" && <>{event.entryCount === 0 && <div className="waiting-callout"><div><p className="eyebrow">Competition ended</p><h3>{event.moderation_notice ? "No artwork is eligible to display" : "No artwork was submitted"}</h3><p>The drawing window is closed. This room is not waiting for the host to start.</p></div></div>}<CompetitionGallery event={event} isHost={isHost} client={client} user={user} /></>}
          {event.phase === "submissions" && canSeeGallery && <CompetitionGallery event={event} isHost={isHost} />}
          {event.phase === "submissions" && !canSeeGallery && hasSubmitted && <div className="gallery-locked"><p className="eyebrow">Step 2 · Gallery</p><h3>Entries are hidden for now</h3><p>{event.challenge_key ? "The gallery will appear automatically when the drawing timer ends." : "The gallery will appear automatically when the host opens voting or enables early viewing."}</p></div>}
        </section>
      </>}
  </main>;
}
