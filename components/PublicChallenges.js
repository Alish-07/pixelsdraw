"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { challengeCountdown as remaining } from "@/lib/site-ui.mjs";
import { challengeTiming } from "@/lib/public-challenge-ui.mjs";

export default function PublicChallenges({ client }) {
  const [rounds, setRounds] = useState([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [archive, setArchive] = useState(false);
  const [lane, setLane] = useState("all");
  const [archiveLimit, setArchiveLimit] = useState(12);
  const [now, setNow] = useState(0);
  const request = useRef(0);
  const loading = useRef(false);
  const retryAfter = useRef(0);
  const invalidateRequests = useCallback(() => { request.current++; }, []);
  const load = useCallback(async () => {
    if (!client) { setLoaded(true); return; }
    if (loading.current || Date.now() < retryAfter.current) return;
    loading.current = true;
    const id = ++request.current;
    try {
      const { data, error } = await client.rpc("pixel_public_challenges");
      if (error) throw error;
      if (id !== request.current) return;
      setRounds(data || []); setError("");
    } catch (error) {
      if (error.code === "PT429" || error.status === 429) retryAfter.current = Date.now() + 60000;
      if (id === request.current) setError(error.code === "PT429" || error.status === 429
        ? "Challenges are busy right now. Please wait a minute before trying again."
        : "We couldn't update the challenges. Check your connection and try again.");
    } finally { loading.current = false; if (id === request.current) setLoaded(true); }
  }, [client]);
  useEffect(() => {
    let cancelled = false;
    const first = window.setTimeout(() => { if (!cancelled) { load(); setNow(Date.now()); } }, 0);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);
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
    <div className="section-heading"><div><p className="eyebrow">Open to everyone</p><h2>Public challenges</h2></div>
      <div className="history-tabs" role="group" aria-label="Public challenge history">
        <button aria-pressed={!archive} onClick={() => setArchive(false)}>Live rounds</button>
        <button aria-pressed={archive} onClick={() => { setArchive(true); setArchiveLimit(12); }}>Past results</button>
      </div></div>
    <p className="challenge-intro">Drop into a quick round or take your time with a six-hour challenge. Sign in when you&apos;re ready to draw or vote.</p>
    {archive && <label className="challenge-filter">Browse results<select value={lane} onChange={event => { setLane(event.target.value); setArchiveLimit(12); }}><option value="all">All challenges</option><option value="sprint">Quick play</option><option value="daily">Long-form challenges</option></select></label>}
    {error && <p role="alert" className="error-notice">{error} <button className="secondary-button" onClick={load}>Retry</button></p>}
    {!loaded ? <div className="public-challenge-grid" role="status" aria-label="Loading challenges">{[0, 1].map(id => <div className="challenge-skeleton" key={id}><span /><span /><span /></div>)}<span className="sr-only">Loading challenges…</span></div> : <div className="public-challenge-grid">{displayed.map(round => <article className="public-challenge-card" key={round.id}>
      <div className="section-heading"><span className="eyebrow">{challengeTiming(round).label}</span><span className="timer-chip">{round.phase === "submissions" ? "Drawing" : round.phase === "voting" ? "Voting" : "Ended"}</span></div>
      <h3>{round.title}</h3><p className="public-challenge-theme">{round.theme}</p>
      <div className="challenge-facts"><span>{round.size} × {round.size}</span>{challengeTiming(round).drawing && <span>{challengeTiming(round).drawing} to draw</span>}{challengeTiming(round).voting && <span>{challengeTiming(round).voting} to vote</span>}</div>
      <p className="challenge-activity">{round.entry_count} {round.entry_count === 1 ? "entry" : "entries"} · {round.ballot_count} {round.ballot_count === 1 ? "voter" : "voters"}</p>
      <p className="public-challenge-clock">{round.phase === "submissions" ? `Drawing closes in ${remaining(round.submission_deadline, now)}` : round.phase === "voting" ? `Voting closes in ${remaining(round.voting_deadline, now)}` : !archive ? `Next round in ${remaining(round.next_round_at, now)}` : new Date(round.round_start).toLocaleString()}</p>
      <Link className="primary-button button-link" aria-label={`${round.phase === "submissions" ? "Join" : round.phase === "voting" ? "Vote in" : "View results for"} ${round.title}`} href={`/events/${round.id}`}>{round.phase === "submissions" ? "Start creating" : round.phase === "voting" ? "Explore & vote" : "See results"}<span aria-hidden="true"> →</span></Link>
    </article>)}{!shown.length && !error && <p>{!client ? "Public challenges are temporarily unavailable. You can still create in the studio." : archive ? "No completed rounds yet. Results will appear here automatically." : "The first public rounds are starting shortly."}</p>}</div>}
    {archive && shown.length > archiveLimit && <button className="secondary-button" onClick={() => setArchiveLimit(archiveLimit + 12)}>Show more results</button>}
    <details className="challenge-guide"><summary>How to take part</summary><div><p>Browse any challenge. Sign in with Google or email when you&apos;re ready to enter or vote.</p><p>Submit one original piece before drawing closes. Entries are revealed together when voting opens. Rank up to three favorites; you can change your vote until the timer ends. You can&apos;t vote for your own entry.</p><p>Quick play gives you 15 minutes to draw and 5 minutes to vote. Long-form rounds give you 6 hours to draw and 30 minutes to vote, then a new round begins. Already-running daily rounds keep their original deadlines.</p><p>Be kind, share original work, and keep the gallery welcoming. If something doesn&apos;t belong, use “Report artwork” in the gallery.</p></div></details>
  </section>;
}
