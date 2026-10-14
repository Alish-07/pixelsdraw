"use client";

import { useState } from "react";

export default function EntryReport({ entry, client, user, onReported }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (busy || sent) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const { error } = await client.rpc("pixel_report_entry", { p_entry: entry.id, p_reason: data.get("reason"), p_details: data.get("details") || "" });
      if (error) throw error;
      setSent(true); setOpen(false); setMessage("Thanks for helping keep the gallery welcoming. Your report has been sent for review.");
      onReported?.();
    } catch (error) { setMessage(["PGRST202", "42703"].includes(error?.code) ? "Reporting is temporarily unavailable. Please try again later." : error.message || "Could not send the report. Please retry."); }
    finally { setBusy(false); }
  }
  return <div className="entry-report">
    <button className="text-button" type="button" disabled={busy || sent} aria-expanded={open} onClick={() => { setOpen(!open); setMessage(""); }}>{sent ? "Reported" : open ? "Cancel report" : "Report artwork"}</button>
    {open && (user && !user.is_anonymous ? <form onSubmit={submit}>
      <label>Reason<select name="reason" required disabled={busy}><option value="">Choose a reason</option><option value="spam">Spam</option><option value="harassment">Harassment or hate</option><option value="inappropriate">Inappropriate content</option><option value="copied">Copied artwork</option><option value="other">Other</option></select></label>
      <label>Optional details<textarea name="details" maxLength={500} rows={3} disabled={busy} placeholder="Explain the issue. Do not include private contact details." /></label>
      <small>Only our moderation team can see your report.</small>
      <button className="secondary-button" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
    </form> : <p>Sign in with Google or email above to report artwork.</p>)}
    {message && <p role="status">{message}</p>}
  </div>;
}
