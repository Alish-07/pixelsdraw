"use client";

export default function RoomControls({ event, busy, countdown, onControls, onAdmit, onSchedule }) {
  const joiningOpen = ["lobby", "submissions"].includes(event.phase);
  return <section className="room-controls-card"><div className="section-heading"><div><p className="eyebrow">Host dashboard</p><h3>Players & admission</h3></div><span>{event.pendingPlayers?.length || 0} waiting for approval</span></div>
    <form onSubmit={onControls} key={`${event.admission_mode}:${event.allow_late_join}`}><fieldset disabled={busy || !joiningOpen} className="admission-fields">
      <label>New player admission<select name="admissionMode" defaultValue={event.admission_mode || "auto"}><option value="auto">Auto admit</option><option value="approval">Wait for approval</option><option value="closed">Stop new players</option></select></label>
      <label className="checkbox-row"><input name="allowLateJoin" type="checkbox" defaultChecked={event.allow_late_join !== false} /> Admit new players after drawing starts</label><button className="primary-button">Save admission</button>
    </fieldset></form>
    <p className="host-hint">Stopping admissions keeps existing players in the room. Switching to Auto does not approve requests already in the queue.</p>
    {(event.pendingPlayers || []).map((player) => <div className="approval-row" key={player.id}><strong>{player.nickname}</strong><span>Waiting for approval</span><button className="primary-button" disabled={busy || !joiningOpen || event.admission_mode === "closed" || (event.phase !== "lobby" && !event.allow_late_join)} onClick={() => onAdmit(player.id, true)}>Admit</button><button className="text-button" disabled={busy} onClick={() => onAdmit(player.id, false)}>Decline</button></div>)}
    {event.phase === "lobby" && <div className="scheduled-start"><h4>Countdown start</h4>{event.scheduled_start_at ? <p role="status">Drawing starts in <strong>{countdown}</strong></p> : <p>Start now with the host button, or schedule a shared countdown.</p>}
      <form onSubmit={(e) => { e.preventDefault(); onSchedule(new FormData(e.currentTarget).get("startDelay")); }}><label>Start in (minutes:seconds)<input name="startDelay" placeholder="2:00" required /></label><button className="primary-button" disabled={busy || !event.participantCount}>{event.scheduled_start_at ? "Replace countdown" : "Schedule start"}</button>{event.scheduled_start_at && <button type="button" className="text-button" disabled={busy} onClick={() => onSchedule(0)}>Cancel countdown</button>}</form><small>Admit at least one player first. Drawing time begins at the scheduled start, not when somebody refreshes.</small>
    </div>}
  </section>;
}
