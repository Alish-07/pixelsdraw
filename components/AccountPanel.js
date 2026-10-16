"use client";

import { useState } from "react";
import Link from "next/link";
import GoogleSignIn from "./GoogleSignIn";
import EmailPasswordAuth from "./EmailPasswordAuth";
import { PasskeySignIn } from "./Passkeys";

export default function AccountPanel(props) {
  // Discard messages and pending form state when the account changes.
  return <AccountPanelSession key={props.user?.id || "guest"} {...props} />;
}

function AccountPanelSession({ client, user, ready, publicChallenge = false, general = false }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  async function signOut() {
    setMessage("");
    setBusy(true);
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
    } catch {
      setMessage("Could not sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-panel" aria-label="Account">
      {!ready ? <p>Checking your account…</p> : user && !user.is_anonymous ? (
        <div className="account-row"><span>Signed in as <strong>{user.email}</strong></span>
          <button className="text-button" disabled={busy} onClick={signOut}>Sign out</button></div>
      ) : (
        <div className="host-signin-options">
          <div><h3>{general ? "Welcome to PixelsDraw" : publicChallenge ? "Join the challenge" : "Create your own competition"}</h3><p>{general ? "Log in or create your PixelsDraw account." : publicChallenge ? "Sign in to share your art and vote for your favorites." : "Sign in to host. Your friends can join with just a nickname."}</p></div>
          <div className="auth-provider-options"><GoogleSignIn client={client} disabled={busy || passkeyBusy} onBusyChange={setGoogleBusy} />
            <PasskeySignIn client={client} disabled={busy || googleBusy} onBusyChange={setPasskeyBusy} /></div>
          <div className="signin-divider"><span>or use email</span></div>
          <EmailPasswordAuth client={client} disabled={googleBusy || passkeyBusy} onBusyChange={setBusy} />
          <p className="account-policy-note">Read our <Link href="/privacy">privacy policy</Link> and <Link href="/terms">community rules and terms</Link> before participating.</p>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
