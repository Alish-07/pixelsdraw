"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { challengeCountdown as remaining } from "@/lib/site-ui.mjs";

export default function PublicChallenges({ client }) {
  const [rounds, setRounds] = useState([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [archive, setArchive] = useState(false);
  const [lane, setLane] = useState("all");
  const [archiveLimit, setArchiveLimit] = useState(12);
  const [now, setNow] = useState(0);
  const request = useRef(0);
  const invalidateRequests = useCallback(() => { request.current++; }, []);
  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const { data, error } = await client.rpc("pixel_public_challenges");
      if (error) throw error;
      if (id !== request.current) return;
      setRounds(data || []); setError("");
    } catch {
      if (id === request.current) setError("We couldn't update the challenges. Check your connection and try again.");
    } finally { if (id === request.current) setLoaded(true); }
  }, [client]);
  useEffect(() => {
    let cancelled = false;
    const first = window.setTimeout(() => { if (!cancelled) { load(); setNow(Date.now()); } }, 0);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const resume = () => { if (document.visibilityState === "visible") { setNow(Date.now()); load(); } };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { cancelled = true; invalidateRequests(); window.clearTimeout(first); window.clearInterval(poll); window.clearInterval(clock); window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); };
  }, [load, invalidateRequests]);
  // Keep the latest slot for each lane, including its quiet results interval.
  const current = rounds.filter((round, i) => rounds.findIndex(other => other.challenge_key === round.challenge_key) === i);
  const shown = archive ? rounds.filter(round => round.phase === "results" && (lane === "all" || round.challenge_key === lane)) : current;
  const displayed = archive ? shown.slice(0, archiveLimit) : shown;
  return <section id="public-challenges" className="public-challenges" aria-label="Public challenges">
    <div className="section-heading"><div><p className="eyebrow">Create. Share. Get inspired.</p><h1>Make something small.<br />Join something bigger.</h1></div>
      <div className="history-tabs" role="group" aria-label="Public challenge history">
        <button aria-pressed={!archive} onClick={() => setArchive(false)}>Live rounds</button>
        <button aria-pressed={archive} onClick={() => { setArchive(true); setArchiveLimit(12); }}>Past results</button>
      </div></div>
    <p className="challenge-intro">A fresh theme, a blank canvas, and a community of creators. Pick a challenge or explore the gallery.</p>
    <div className="challenge-steps" aria-label="How challenges work"><span><b>01</b> Pick a theme</span><span><b>02</b> Create your entry</span><span><b>03</b> Vote for your favorites</span></div>
    {archive && <label className="challenge-filter">Browse results<select value={lane} onChange={event => { setLane(event.target.value); setArchiveLimit(12); }}><option value="all">All challenges</option><option value="sprint">Quick play</option><option value="daily">Daily challenges</option></select></label>}
    {error && <p role="alert" className="error-notice">{error} <button className="secondary-button" onClick={load}>Retry</button></p>}
    {!loaded ? <div className="public-challenge-grid" role="status" aria-label="Loading challenges">{[0, 1].map(id => <div className="challenge-skeleton" key={id}><span /><span /><span /></div>)}<span className="sr-only">Loading challenges…</span></div> : <div className="public-challenge-grid">{displayed.map(round => <article className="public-challenge-card" key={round.id}>
      <div className="section-heading"><span className="eyebrow">{round.challenge_key === "daily" ? "Daily" : "Quick play"}</span><span className="timer-chip">{round.phase === "submissions" ? "Drawing" : round.phase === "voting" ? "Voting" : "Ended"}</span></div>
      <h3>{round.title}</h3><p className="public-challenge-theme">{round.theme}</p>
      <div className="challenge-facts"><span>{round.size} × {round.size}</span><span>{round.challenge_key === "daily" ? "23h to create" : "15m to create"}</span><span>{round.challenge_key === "daily" ? "1h to vote" : "5m to vote"}</span></div>
      <p className="challenge-activity">{round.entry_count} {round.entry_count === 1 ? "entry" : "entries"} · {round.ballot_count} {round.ballot_count === 1 ? "voter" : "voters"}</p>
      <p className="public-challenge-clock">{round.phase === "submissions" ? `Drawing closes in ${remaining(round.submission_deadline, now)}` : round.phase === "voting" ? `Voting closes in ${remaining(round.voting_deadline, now)}` : !archive ? `Next round in ${remaining(round.next_round_at, now)}` : new Date(round.round_start).toLocaleString()}</p>
      <Link className="primary-button button-link" aria-label={`${round.phase === "submissions" ? "Join" : round.phase === "voting" ? "Vote in" : "View results for"} ${round.title}`} href={`/events/${round.id}`}>{round.phase === "submissions" ? "Start creating" : round.phase === "voting" ? "Explore & vote" : "See results"}<span aria-hidden="true"> →</span></Link>
    </article>)}{!shown.length && !error && <p>{archive ? "No completed rounds yet. Results will appear here automatically." : "The first public rounds are starting shortly."}</p>}</div>}
    {archive && shown.length > archiveLimit && <button className="secondary-button" onClick={() => setArchiveLimit(archiveLimit + 12)}>Show more results</button>}
    <details className="challenge-guide"><summary>How to take part</summary><div><p>Browse any challenge. Sign in with Google or email when you&apos;re ready to enter or vote.</p><p>Submit one original piece before drawing closes. Entries are revealed together when voting opens. Rank up to three favorites; you can change your vote until the timer ends. You can&apos;t vote for your own entry.</p><p>Quick-play challenges start every 20 minutes. Daily challenges start at midnight UTC. Both finish with a community vote.</p><p>Be kind, share original work, and keep the gallery welcoming. If something doesn&apos;t belong, use “Report artwork” in the gallery.</p></div></details>
  </section>;
}
