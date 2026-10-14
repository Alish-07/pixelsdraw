"use client";

import { useState } from "react";
import { canvasRules, timerText } from "@/lib/competition-rules.mjs";

// Shared by room creation and host editing. Canvas/animation lock on Start.
export default function CompetitionSettings({ event = null }) {
  const rules = canvasRules(event);
  const [mode, setMode] = useState(rules.mode);
  const [fixedSize, setFixedSize] = useState(rules.sizes[0] || event?.size || 32);
  const [percent, setPercent] = useState(event?.host_vote_percent || 0);
  const [timerAction, setTimerAction] = useState(event ? "keep" : "change");
  const locked = event && event.phase !== "lobby";
  return <>
    <div className="competition-basic">
      {mode === "fixed" && <label>Canvas size (square side)<input name="allowedSizes" type="number" min="1" max="1024" value={fixedSize} onChange={(e) => setFixedSize(e.target.value)} disabled={locked} required /><small>{fixedSize || "…"} × {fixedSize || "…"}. Any whole size from 1 to 1024; more options in Advanced rules.</small></label>}
      <label>Drawing timer {event && <select name="timerAction" value={timerAction} onChange={(e) => setTimerAction(e.target.value)}><option value="keep">Keep current timer</option><option value="change">{event.phase === "lobby" ? "Change duration" : "Restart / turn off"}</option></select>}
        <input name="duration" placeholder="10:30" defaultValue={timerText(event?.submission_duration_seconds || event?.submission_duration_minutes * 60)} disabled={timerAction === "keep"} aria-label="Drawing duration, minutes:seconds" />
        <small>Minutes:seconds; blank = no drawing timer. When it ends, voting opens automatically with two or more entries.{event?.phase === "submissions" && " Changing it restarts from now."}</small>
      </label>
      <label>Voting timer<input name="votingDuration" placeholder="5:00" defaultValue={timerText(event?.voting_duration_seconds ?? 300)} aria-label="Voting duration, minutes:seconds" /><small>Minutes:seconds; blank = 5 minutes. Starts when voting opens and closes automatically, even without votes. Set this before voting starts.</small></label>
      <label>Host voting share (%)<input name="hostVotePercent" type="number" min="0" max="100" step="1" value={percent} onChange={(e) => setPercent(e.target.value)} required /><small>Host {percent || 0}% · participants {100 - Number(percent || 0)}%</small></label>
      <label className="checkbox-row"><input type="checkbox" name="showGallery" defaultChecked={event?.show_gallery || false} /> Show submitted art before voting</label>
    </div>
    <details className="competition-advanced"><summary><span>Advanced room settings</span><span className="advanced-chevron" aria-hidden="true">⌄</span></summary>
      <p className="advanced-description">Canvas rules, animation and participant visibility</p>
      {locked && <p>Canvas and animation rules are locked once drawing starts. Visibility and voting balance remain editable until voting.</p>}
      <fieldset disabled={locked}>
        <label>Allowed canvas sizes<select name="canvasMode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="fixed">One exact size</option><option value="list">Specific sizes only</option><option value="range">Every size in a range</option></select></label>
        {mode === "list" && <label>Allowed side lengths (comma-separated)<input name="allowedSizes" defaultValue={rules.sizes.join(", ")} required placeholder="37, 91" /><small>Arbitrary sizes; e.g. 37, 91 allows only those two sizes, not the sizes between.</small></label>}
        {mode === "range" && <div className="range-fields"><label>Minimum side<input type="number" name="minimum" min="1" max="1024" defaultValue={rules.min || 1} required /></label><label>Maximum side<input type="number" name="maximum" min="1" max="1024" defaultValue={rules.max || 1024} required /></label><small>All integer square sizes between these limits. Use 1 for no minimum or 1024 for the platform maximum.</small></div>}
        <label>Animation<select name="animation" defaultValue={event?.animation_mode || "disabled"}><option value="disabled">Disabled · still artwork only</option><option value="optional">Optional · still or animation</option><option value="required">Required · at least two frames</option></select><small>Up to 32 frames, 24 FPS, and 4,194,304 submitted pixels total.</small></label>
      </fieldset>
      {locked && <><input type="hidden" name="canvasMode" value={rules.mode} /><input type="hidden" name="allowedSizes" value={rules.sizes.join(",")} /><input type="hidden" name="minimum" value={rules.min} /><input type="hidden" name="maximum" value={rules.max} /><input type="hidden" name="animation" value={event.animation_mode || "disabled"} /></>}
      <label className="checkbox-row"><input type="checkbox" name="showPoints" defaultChecked={event?.show_points !== false} /> Show points to participants in final results</label><small>Rankings and winner frames stay visible. Hidden points remain visible to the host only.</small>
      <label className="checkbox-row"><input type="checkbox" name="showRoster" defaultChecked={event?.show_roster !== false} /> Let participants see other players in the room</label><small>The host always sees the roster and approval queue.</small>
      {!event && <><label>New player admission<select name="admissionMode" defaultValue="auto"><option value="auto">Automatically admit</option><option value="approval">Wait for host approval</option><option value="closed">Stop new joins</option></select></label><label className="checkbox-row"><input type="checkbox" name="allowLateJoin" defaultChecked /> Allow new players after drawing starts</label></>}
    </details>
  </>;
}
