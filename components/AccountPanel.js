"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { friendlyAuthError } from "@/lib/site-ui.mjs";
import GoogleSignIn from "./GoogleSignIn";
import { emailSignInEnabled } from "@/lib/site-config.mjs";

export default function AccountPanel({ client, user, ready, publicChallenge = false, general = false }) {
  const emailEnabled = emailSignInEnabled();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [emailWait, setEmailWait] = useState(0);
  useEffect(() => {
    if (!emailWait) return;
    const timer = window.setTimeout(() => setEmailWait(emailWait - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [emailWait]);

  async function sendSignInLink(event) {
    event.preventDefault();
    if (!emailEnabled || busy || googleBusy || emailWait) return;
    const email = new FormData(event.currentTarget).get("email").trim();
    setBusy(true);
    setMessage("");
    try {
      if (publicChallenge && user?.is_anonymous) {
        const { error } = await client.auth.signOut({ scope: "local" });
        if (error) throw error;
      }
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname + window.location.search },
      });
      if (error) throw error;
      setEmailWait(60);
      setMessage("Your sign-in link is on its way. Check your inbox and spam folder.");
    } catch (error) {
      setMessage(friendlyAuthError(error));
      if (error?.status === 429 || /rate limit|too many requests/i.test(error?.message || "")) setEmailWait(60);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      setMessage("Signed out.");
    } catch (error) {
      setMessage(error.message || "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-panel" aria-label="Account">
      {!ready ? <p>Checking your account…</p> : user?.is_anonymous && !publicChallenge && !general ? (
        <div className="account-row"><span>Playing as a guest</span>
          <GoogleSignIn client={client} disabled={busy} onBusyChange={setGoogleBusy} /></div>
      ) : user && !user.is_anonymous ? (
        <div className="account-row"><span>Signed in as <strong>{user.email}</strong></span>
          <button className="text-button" disabled={busy} onClick={signOut}>Sign out</button></div>
      ) : (
        <div className="host-signin-options">
          <div><h3>{general ? "Welcome to PixelsDraw" : publicChallenge ? "Join the challenge" : "Create your own competition"}</h3><p>{general ? emailEnabled ? "Sign in or create your account with Google or an email link." : "Continue with Google to sign in or create your account." : publicChallenge ? "Sign in to share your art and vote for your favorites." : "Sign in to host. Your friends can join with just a nickname."}</p></div>
          <GoogleSignIn client={client} disabled={busy} onBusyChange={setGoogleBusy} />
          {emailEnabled ? <><div className="signin-divider"><span>or use email</span></div>
          <form className="email-signin-form" onSubmit={sendSignInLink}>
            <label>Email address<input type="email" name="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required disabled={busy || googleBusy} /></label>
            <button className="email-link-button" disabled={busy || googleBusy || emailWait > 0}>{busy ? "Please wait…" : emailWait ? `Send again in ${emailWait}s` : "Send sign-in link"}</button>
          </form>
          <p className="email-limit-note">No password to remember. Having trouble getting a link? Try Google.</p></>
            : <p className="email-unavailable-note">Email sign-in isn’t available yet. Please continue with Google.</p>}
          <p className="account-policy-note">Read our <Link href="/privacy">privacy policy</Link> and <Link href="/terms">community rules and terms</Link> before participating.</p>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
