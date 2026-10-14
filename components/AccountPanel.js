"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { friendlyAuthError } from "@/lib/site-ui.mjs";

export default function AccountPanel({ client, user, ready, publicChallenge = false }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailWait, setEmailWait] = useState(0);
  useEffect(() => {
    if (!emailWait) return;
    const timer = window.setTimeout(() => setEmailWait(emailWait - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [emailWait]);

  async function signInWithGoogle({ replaceAnonymousSession = false } = {}) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      // Participant sessions are temporary. Sign out first so Google creates a
      // normal host session instead of leaving the anonymous user active.
      if (replaceAnonymousSession) {
        const { error: signOutError } = await client.auth.signOut();
        if (signOutError) throw signOutError;
      }

      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + window.location.pathname,
        },
      });
      if (error) throw error;
      // A successful call redirects to Google, so no local success message is needed.
    } catch (error) {
      setMessage(friendlyAuthError(error, "Could not open Google sign-in. Please try again."));
      setBusy(false);
    }
  }

  async function sendSignInLink(event) {
    event.preventDefault();
    if (busy || emailWait) return;
    const email = new FormData(event.currentTarget).get("email").trim();
    setBusy(true);
    setMessage("");
    try {
      if (publicChallenge && user?.is_anonymous) {
        const { error } = await client.auth.signOut();
        if (error) throw error;
      }
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
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
      const { error } = await client.auth.signOut();
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
      {!ready ? <p>Checking your account…</p> : user?.is_anonymous && !publicChallenge ? (
        <div className="account-row"><span>Playing as a guest</span>
          <button className="google-button" type="button" disabled={busy}
            onClick={() => signInWithGoogle({ replaceAnonymousSession: true })}>
            <span className="google-mark" aria-hidden="true">G</span>
            {busy ? "Opening Google…" : publicChallenge ? "Continue with Google" : "Continue with Google as host"}
          </button></div>
      ) : user && !user.is_anonymous ? (
        <div className="account-row"><span>Signed in as <strong>{user.email}</strong></span>
          <button className="text-button" disabled={busy} onClick={signOut}>Sign out</button></div>
      ) : (
        <div className="host-signin-options">
          <div><h3>{publicChallenge ? "Join the challenge" : "Create your own competition"}</h3><p>{publicChallenge ? "Sign in to share your art and vote for your favorites." : "Sign in to host. Your friends can join with just a nickname."}</p></div>
          <button className="google-button" type="button" disabled={busy} onClick={() => signInWithGoogle({ replaceAnonymousSession: Boolean(user?.is_anonymous) })}>
            <span className="google-mark" aria-hidden="true">G</span>
            {busy ? "Opening Google…" : "Continue with Google"}
          </button>
          <div className="signin-divider"><span>or use email</span></div>
          <form className="email-signin-form" onSubmit={sendSignInLink}>
            <label>Email address<input type="email" name="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required disabled={busy} /></label>
            <button className="email-link-button" disabled={busy || emailWait > 0}>{busy ? "Please wait…" : emailWait ? `Send again in ${emailWait}s` : "Send sign-in link"}</button>
          </form>
          <p className="email-limit-note">No password to remember. Having trouble getting a link? Try Google.</p>
          <p className="account-policy-note">Read our <Link href="/privacy">privacy policy</Link> and <Link href="/terms">community rules and terms</Link> before participating.</p>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
