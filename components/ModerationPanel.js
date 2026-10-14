"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EntryPreview } from "./CompetitionGallery";

export default function ModerationPanel({ client }) {
  const [reports, setReports] = useState([]);
  const [closed, setClosed] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [offset, setOffset] = useState(0);
  const request = useRef(0);
  const invalidateRequests = useCallback(() => { request.current++; }, []);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoaded(false);
    try {
      const { data, error } = await client.rpc("pixel_moderation_queue", { p_closed: closed, p_offset: offset });
      if (error) throw error;
      if (id !== request.current) return;
      setReports(data || []); setMessage("");
    } catch (error) { if (id === request.current) { setReports([]); setMessage(error.message || "Could not load reports."); } }
    finally { if (id === request.current) setLoaded(true); }
  }, [client, closed, offset]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => { window.clearTimeout(timer); invalidateRequests(); }; }, [load, invalidateRequests]);
  async function review(event, id) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const { error } = await client.rpc("pixel_review_report", { p_report: id, p_action: data.get("action"), p_note: data.get("note") });
      if (error) throw error;
      await load(); setMessage("Review saved in the audit log. Artwork is preserved; hidden entries can be restored from Reviewed reports.");
    } catch (error) { setMessage(error.message || "Could not save the review."); }
    finally { setBusy(false); }
  }
  return <section className="moderation-panel" aria-label="Moderator review queue">
    <div className="section-heading"><div><p className="eyebrow">Private moderator tools</p><h2>Review reports</h2></div><button className="secondary-button" onClick={load} disabled={busy}>Refresh queue</button></div>
    <p>Hiding is reversible. Reports never automatically disqualify artwork. Hidden entries leave the gallery and cannot receive new votes; existing votes and artwork remain stored. Restoring updates the leaderboard again.</p>
    <div className="history-tabs" role="group" aria-label="Report status"><button disabled={busy} aria-pressed={!closed} onClick={() => { setClosed(false); setOffset(0); }}>Pending</button><button disabled={busy} aria-pressed={closed} onClick={() => { setClosed(true); setOffset(0); }}>Reviewed</button></div>
    {message && <p role="status" className="local-notice">{message}</p>}
    {!loaded ? <p>Loading reports…</p> : <div className="moderation-reports">{reports.map(report => <article className="moderation-report" key={report.id}>
      <EntryPreview entry={{ title: report.title, pixels: report.pixels, width: report.width }} size={report.width} />
      <div><Link href={`/events/${report.event_id}`}>{report.event_title}</Link><h3>{report.title} — {report.artist}</h3>
        <p><strong>{report.reason}</strong> · {report.status} · {report.moderation_hidden_at ? "Hidden" : "Visible"}</p><p className="report-details">{report.details || "No additional details."}</p>
        <form onSubmit={event => review(event, report.id)}>
          <label>Action<select name="action" required disabled={busy}><option value="">Choose an action</option><option value="dismiss">Dismiss report</option><option value="hide" disabled={Boolean(report.moderation_hidden_at)}>Hide artwork</option><option value="restore" disabled={!report.moderation_hidden_at}>Restore artwork</option></select></label>
          <label>Review note<textarea name="note" required maxLength={500} rows={2} disabled={busy} /></label>
          <button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save review"}</button>
        </form>
      </div>
    </article>)}{!reports.length && <p>No {closed ? "reviewed" : "pending"} reports on this page.</p>}</div>}
    <div className="history-tabs" role="group" aria-label="Report pages"><button disabled={busy || !loaded || !offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><span>Page {offset / 50 + 1}</span><button disabled={busy || !loaded || reports.length < 50} onClick={() => setOffset(offset + 50)}>Next</button></div>
  </section>;
}
